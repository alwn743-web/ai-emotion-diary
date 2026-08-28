/**
 * AI 감정 일기 (AI Emotion Diary) - Core Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Supabase Browser Client
    let supabase = null;
    if (window.supabase && window.ENV && window.ENV.SUPABASE_URL) {
        supabase = window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);
    }

    // Auth UI Elements Selection
    const authCard = document.getElementById('authCard');
    const mainDiaryApp = document.getElementById('mainDiaryApp');
    const authEmail = document.getElementById('authEmail');
    const authPassword = document.getElementById('authPassword');
    const authMessage = document.getElementById('authMessage');
    const loginBtn = document.getElementById('loginBtn');
    const signUpBtn = document.getElementById('signUpBtn');
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    const userBar = document.getElementById('userBar');
    const userEmailText = document.getElementById('userEmailText');
    const logoutBtn = document.getElementById('logoutBtn');

    // UI Elements Selection
    const diaryInput = document.getElementById('diaryInput');
    const charCounter = document.getElementById('charCounter');
    const voiceBtn = document.getElementById('voiceBtn');
    const voiceBtnText = document.getElementById('voiceBtnText');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceStatusText = document.getElementById('voiceStatusText');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const chipBtns = document.querySelectorAll('.chip-btn');
    
    // Result UI Elements
    const responseBox = document.getElementById('responseBox');
    const placeholderText = document.getElementById('placeholderText');
    const responseContent = document.getElementById('responseContent');
    const aiStatusBadge = document.getElementById('aiStatusBadge');
    const primaryEmotionPill = document.getElementById('primaryEmotionPill');
    const scorePill = document.getElementById('scorePill');
    const aiTextBody = document.getElementById('aiTextBody');
    const quoteText = document.getElementById('quoteText');
    const recDetail = document.getElementById('recDetail');
    
    // History UI Elements
    const historySection = document.getElementById('historySection');
    const historyList = document.getElementById('historyList');
    const historyCount = document.getElementById('historyCount');
    // Profile Avatar UI Elements
    const avatarClickArea = document.getElementById('avatarClickArea');
    const userAvatarImg = document.getElementById('userAvatarImg');
    const changePhotoBtn = document.getElementById('changePhotoBtn');
    const avatarFileInput = document.getElementById('avatarFileInput');

    // Realtime Chat UI Elements
    const chatSection = document.getElementById('chatSection');
    const chatMessagesContainer = document.getElementById('chatMessagesContainer');
    const chatMessagesList = document.getElementById('chatMessagesList');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatClipBtn = document.getElementById('chatClipBtn');
    const chatImageFileInput = document.getElementById('chatImageFileInput');
    const chatSendBtn = document.getElementById('chatSendBtn');
    let chatChannel = null;

    // State Variables
    let isRecording = false;
    let recognition = null;
    let currentUserId = null;
    let historyData = JSON.parse(localStorage.getItem('ai_diary_history') || '[]');

    /* ==========================================================================
       Auth State Listener & View Switcher
       ========================================================================== */
    function updateAuthUI(session) {
        if (session && session.user) {
            currentUserId = session.user.id;
            authCard.style.display = 'none';
            mainDiaryApp.style.display = 'flex';
            userEmailText.textContent = session.user.email || '로그인 사용자';

            // Load user profile avatar image (or default Hello Kitty)
            const savedAvatar = localStorage.getItem(`user_avatar_${session.user.id}`);
            if (userAvatarImg) {
                userAvatarImg.src = savedAvatar || 'assets/hello_kitty.jpg';
            }

            // Restore user-scoped latest diary input and AI response
            restoreLatestEntry(session.user.id);

            // Load user-isolated history from Serverless Redis
            loadHistoryFromRedis();

            // Initialize Supabase Realtime Broadcast Chat
            initRealtimeChat(session.user);
        } else {
            currentUserId = null;
            authCard.style.display = 'flex';
            mainDiaryApp.style.display = 'none';
            historySection.style.display = 'none';
            historyList.innerHTML = '';
            if (userAvatarImg) {
                userAvatarImg.src = 'assets/hello_kitty.jpg';
            }
            if (chatChannel && supabase) {
                supabase.removeChannel(chatChannel);
                chatChannel = null;
            }
        }
    }

    function showAuthMessage(msg, isSuccess = false) {
        authMessage.style.display = 'block';
        authMessage.textContent = msg;
        authMessage.className = `auth-message ${isSuccess ? 'success' : 'error'}`;
    }

    if (supabase) {
        // Initial session check
        supabase.auth.getSession().then(({ data: { session } }) => {
            updateAuthUI(session);
        });

        // Listen for Auth changes
        supabase.auth.onAuthStateChange((_event, session) => {
            updateAuthUI(session);
        });
    }

    // Auth Form Enter Key Submit Handler
    const authForm = document.getElementById('authForm');
    if (authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (loginBtn) loginBtn.click();
        });
    }

    // Email Login Event Handler
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const email = authEmail.value.trim();
            const password = authPassword.value.trim();

            if (!email || !password) {
                showAuthMessage('이메일과 비밀번호를 모두 입력해 주세요.');
                return;
            }

            if (supabase) {
                loginBtn.disabled = true;
                loginBtn.textContent = '로그인 중...';

                const { data, error } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                loginBtn.disabled = false;
                loginBtn.textContent = '로그인';

                if (error) {
                    showAuthMessage(error.message || '로그인 중 오류가 발생했습니다.');
                } else {
                    showAuthMessage('로그인 성공! 환영합니다.', true);
                }
            } else {
                showAuthMessage('Supabase 클라이언트 연결 실패.');
            }
        });
    }

    // Email Sign Up Event Handler
    if (signUpBtn) {
        signUpBtn.addEventListener('click', async () => {
            const email = authEmail.value.trim();
            const password = authPassword.value.trim();

            if (!email || !password) {
                showAuthMessage('회원가입할 이메일과 비밀번호를 입력해 주세요.');
                return;
            }

            if (password.length < 6) {
                showAuthMessage('비밀번호는 최소 6자 이상이어야 합니다.');
                return;
            }

            if (supabase) {
                signUpBtn.disabled = true;
                signUpBtn.textContent = '가입 처리 중...';

                const { data, error } = await supabase.auth.signUp({
                    email: email,
                    password: password
                });

                signUpBtn.disabled = false;
                signUpBtn.textContent = '회원가입';

                if (error) {
                    showAuthMessage(error.message || '회원가입 중 오류가 발생했습니다.');
                } else {
                    showAuthMessage('가입 확인 이메일을 확인해주세요!', true);
                }
            }
        });
    }

    // Google OAuth Login Event Handler
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', async () => {
            if (!supabase) {
                showAuthMessage('Supabase 클라이언트가 로드되지 않았습니다.');
                return;
            }

            try {
                googleLoginBtn.disabled = true;
                showAuthMessage('Google 인증 페이지로 이동 중입니다...', true);

                const { data, error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin
                    }
                });

                if (error) {
                    googleLoginBtn.disabled = false;
                    showAuthMessage(error.message || 'Google 로그인 진행 중 오류가 발생했습니다.');
                }
            } catch (err) {
                googleLoginBtn.disabled = false;
                showAuthMessage(err.message || 'Google 로그인 처리 중 오류가 발생했습니다.');
            }
        });
    }

    // Logout Event Handler
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (supabase) {
                await supabase.auth.signOut();
            }
        });
    }

    // Initialize App Settings
    initCurrentDate();
    initSpeechRecognition();
    restoreLatestEntry();

    /* ==========================================================================
       0. LocalStorage Persistence Logic (Save & Restore on Reload)
       ========================================================================== */
    function saveLatestEntry(diaryText, aiResponseText) {
        try {
            const uid = currentUserId || 'guest';
            if (diaryText !== undefined && diaryText !== null) {
                localStorage.setItem(`latest_diary_input_${uid}`, diaryText);
            }
            if (aiResponseText !== undefined && aiResponseText !== null) {
                localStorage.setItem(`latest_ai_response_${uid}`, aiResponseText);
            }
        } catch (err) {
            console.warn('LocalStorage 저장 실패:', err);
        }
    }

    function restoreLatestEntry(userId) {
        try {
            const uid = userId || currentUserId || 'guest';
            const savedDiary = localStorage.getItem(`latest_diary_input_${uid}`);
            const savedAiResponse = localStorage.getItem(`latest_ai_response_${uid}`);

            if (savedDiary) {
                diaryInput.value = savedDiary;
                charCounter.textContent = `${savedDiary.length}자`;
            } else {
                diaryInput.value = '';
                charCounter.textContent = '0자';
            }

            if (savedAiResponse) {
                displayGeminiResponse(savedAiResponse, savedDiary || '', false);
            } else {
                placeholderText.style.display = 'block';
                placeholderText.innerHTML = '여기에 AI의 답변이 표시됩니다.';
                responseContent.style.display = 'none';
                responseBox.classList.remove('has-content');
            }
        } catch (err) {
            console.warn('LocalStorage 복원 중 오류:', err);
        }
    }

    // Auto-save draft on input typing
    diaryInput.addEventListener('input', () => {
        const text = diaryInput.value;
        charCounter.textContent = `${text.length}자`;
        const uid = currentUserId || 'guest';
        localStorage.setItem(`latest_diary_input_${uid}`, text);
    });

    /* ==========================================================================
       1. Date Display Initialization
       ========================================================================== */
    function initCurrentDate() {
        const now = new Date();
        const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
        currentDateText.textContent = now.toLocaleDateString('ko-KR', options);
    }

    /* ==========================================================================
       2. Text Counter & Quick Prompt Chips
       ========================================================================== */
    diaryInput.addEventListener('input', () => {
        const len = diaryInput.value.length;
        charCounter.textContent = `${len}자`;
    });

    chipBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const insertText = btn.getAttribute('data-text');
            diaryInput.value += insertText;
            diaryInput.focus();
            charCounter.textContent = `${diaryInput.value.length}자`;
        });
    });

    /* ==========================================================================
       3. Speech-to-Text (Web Speech API) Integration
       ========================================================================== */
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.warn('Speech Recognition is not supported in this browser.');
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR'; // Korean Language Recognition
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => {
            isRecording = true;
            voiceBtn.classList.add('recording');
            voiceBtnText.textContent = '음성 인식 중...';
            voiceStatus.style.display = 'flex';
            voiceStatusText.textContent = '음성을 듣고 있습니다... 말씀해 주세요!';
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                const space = diaryInput.value && !diaryInput.value.endsWith(' ') && !diaryInput.value.endsWith('\n') ? ' ' : '';
                diaryInput.value += space + finalTranscript;
                charCounter.textContent = `${diaryInput.value.length}자`;
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            stopRecording();
            if (event.error === 'not-allowed') {
                alert('마이크 접근 권한이 거부되었습니다. 브라우저 설정에서 마이크 권한을 허용해 주세요.');
            }
        };

        recognition.onend = () => {
            stopRecording();
        };
    }

    function stopRecording() {
        isRecording = false;
        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                // Ignore if already stopped
            }
        }
        voiceBtn.classList.remove('recording');
        voiceBtnText.textContent = '음성으로 입력하기';
        voiceStatus.style.display = 'none';
    }

    voiceBtn.addEventListener('click', () => {
        if (!recognition) {
            alert('현재 브라우저에서는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 사용해 주세요.');
            return;
        }

        if (isRecording) {
            stopRecording();
        } else {
            try {
                recognition.start();
            } catch (err) {
                console.error('Failed to start recognition:', err);
            }
        }
    });

    async function getAuthHeader() {
        if (supabase) {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session && session.access_token) {
                    return { 'Authorization': `Bearer ${session.access_token}` };
                }
            } catch (e) {
                console.warn('Supabase 세션 토큰 가져오기 실패:', e);
            }
        }
        return {};
    }

    /* ==========================================================================
       4. Backend Vercel Serverless API (/api/analyze) Integration
       ========================================================================== */

    async function callVercelAnalyzeAPI(userDiaryText) {
        const authHeaders = await getAuthHeader();

        // Attempt POST to /api/analyze (Vercel canonical route)
        let response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            },
            body: JSON.stringify({ text: userDiaryText })
        }).catch(() => null);

        // Fallback to /api/analyze.js if direct route is required by environment
        if (!response || !response.ok) {
            response = await fetch('/api/analyze.js', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders
                },
                body: JSON.stringify({ text: userDiaryText })
            });
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            throw new Error(data.error || `[Vercel Serverless Error] HTTP ${response.status}`);
        }

        return data.result;
    }

    analyzeBtn.addEventListener('click', async () => {
        const text = diaryInput.value.trim();

        if (!text) {
            alert('오늘의 일기 내용을 입력하거나 음성으로 말해주세요!');
            diaryInput.focus();
            return;
        }

        if (isRecording) {
            stopRecording();
        }

        // Set Loading UI State
        setLoadingState(true);

        try {
            // Call Vercel Backend Serverless API
            const apiReply = await callVercelAnalyzeAPI(text);
            displayGeminiResponse(apiReply, text);
        } catch (error) {
            console.error('Vercel API Error:', error);
            displayGeminiError(error.message);
        }
    });

    function displayGeminiError(errorMessage) {
        placeholderText.style.display = 'none';
        
        primaryEmotionPill.textContent = '오류 발생';
        scorePill.textContent = 'Gemini API Error';
        
        aiTextBody.innerHTML = `<span style="color: #f87171; font-weight: 500;">⚠️ Gemini API 호출 중 오류가 발생했습니다:</span>\n${errorMessage}`;
        quoteText.textContent = 'API 응답 오류';
        recDetail.textContent = 'API 키 상태나 네트워크 연결을 확인하고 다시 시도해 주세요.';

        responseContent.style.display = 'flex';
        responseBox.classList.add('has-content');

        aiStatusBadge.textContent = '오류 발생';
        aiStatusBadge.className = 'status-badge';
        analyzeBtn.disabled = false;

        responseBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function displayGeminiResponse(replyText, originalText, isNew = true) {
        // Parse "감정: [요약된 감정]\n\n[응원 메시지]"
        let emotionName = '감정 분석 완료';
        let messageBody = replyText;

        const emotionMatch = replyText.match(/감정:\s*([^\n]+)/);
        if (emotionMatch && emotionMatch[1]) {
            emotionName = emotionMatch[1].trim();
        }

        // Extract body after double newline if format matches
        const parts = replyText.split(/\n\n+/);
        if (parts.length > 1) {
            messageBody = parts.slice(1).join('\n\n');
        }

        // Hide placeholder text
        placeholderText.style.display = 'none';

        // Populate Dynamic AI Content
        primaryEmotionPill.textContent = `감정: ${emotionName}`;
        scorePill.textContent = `Gemini AI Flash`;

        aiTextBody.textContent = messageBody;
        quoteText.textContent = `감정 요약: ${emotionName}`;
        recDetail.textContent = `Gemini API를 통한 맞춤형 심리 상담 및 응원 메시지입니다.`;

        // Show Response Content Container
        responseContent.style.display = 'flex';
        responseBox.classList.add('has-content');

        // Update status badge & save history
        aiStatusBadge.textContent = isNew ? '분석 완료 (Gemini API)' : '저장된 분석 결과';
        aiStatusBadge.className = 'status-badge complete';
        analyzeBtn.disabled = false;

        if (isNew) {
            // Save latest diary input and AI response to localStorage
            saveLatestEntry(originalText, replyText);

            saveToHistory(originalText, {
                emotionName: emotionName,
                quote: messageBody.substring(0, 40) + '...'
            });

            // Scroll smooth to result
            responseBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function setLoadingState(isLoading) {
        if (isLoading) {
            analyzeBtn.disabled = true;
            aiStatusBadge.textContent = 'Gemini API 분석 중...';
            aiStatusBadge.className = 'status-badge analyzing';
            
            // Temporary shimmer/loading feedback in response box
            responseBox.classList.remove('has-content');
            placeholderText.innerHTML = `<span class="loading-shimmer">✨ Gemini API가 일기를 읽고 심리 상담가로서 공감 답변을 작성 중입니다...</span>`;
            responseContent.style.display = 'none';
        } else {
            analyzeBtn.disabled = false;
            aiStatusBadge.textContent = '분석 완료';
            aiStatusBadge.className = 'status-badge complete';
        }
    }

    // Keyword Sentiment Dictionary & Response Knowledge Base
    const emotionDictionary = [
        {
            key: 'joy',
            name: '😊 기쁨 & 보람',
            color: '#c084fc',
            keywords: ['기쁜', '기분', '좋았', '행복', '성공', '웃음', '뿌듯', '즐거', '신나', '보람', '홀가분', '최고', '달성', '완성'],
            responses: [
                "오늘 하루 성취감과 뿌듯함이 가득한 순간들을 보내셨군요! 당신의 진심 어린 노력들이 좋은 결실을 맺어 정말 기쁩니다.",
                "밝고 긍정적인 에너지가 일기 문장 하나하나에서 따뜻하게 뿜어져 나오는 것 같아요. 이런 멋진 날을 기록해둔 것 자체가 선물입니다."
            ],
            quotes: [
                "행복은 마음속 작은 만족과 기쁨을 알아채는 순간 찾아옵니다.",
                "오늘 당신이 만든 작은 성취가 내일의 더 큰 빛이 될 것입니다."
            ],
            recommendations: [
                "좋았던 기분을 오래 간직할 수 있도록 즐거웠던 장면을 사진이나 메모로 남겨보세요! 📸",
                "신나는 분위기의 플레이리스트를 들으며 맛있는 디저트로 오늘을 축하해보세요! 🍰"
            ],
            baseEnergy: 90
        },
        {
            key: 'fatigue',
            name: '😮‍💨 피로 & 지침',
            color: '#fcd34d',
            keywords: ['피곤', '지친', '지쳤', '힘들', '스트레스', '쉬고', '자고', '버겁', '지침', '야근', '고단', '몸이'],
            responses: [
                "오늘 하루 무거운 짐을 안고 묵묵히 버텨내시느라 정말 고생 많으셨습니다. 아무것도 하지 않고 편히 쉴 자격이 충분해요.",
                "몸과 마음이 신호를 보내고 있는 것 같아요. 때로는 한 걸음 쉬어가는 것이 더 멀리 가기 위한 가장 지혜로운 방법입니다."
            ],
            quotes: [
                "쉼은 게으름이 아니라, 지친 당신을 위한 가장 필요한 충전 시간입니다.",
                "오늘 지친 자신에게 '정말 애썼어'라고 따뜻한 한마디를 건네주세요."
            ],
            recommendations: [
                "따뜻한 온수로 족욕을 하거나 차분한 아로마 향과 함께 푹 쉬어보세요. 🛁",
                "스마트폰을 잠시 내려놓고 잔잔한 빗소리/자연 소리를 들으며 일찍 잠자리에 들어보세요. 🌙"
            ],
            baseEnergy: 45
        },
        {
            key: 'anxiety',
            name: '😟 불안 & 걱정',
            color: '#f87171',
            keywords: ['불안', '걱정', '두렵', '초조', '부담', '떨리', '어쩌지', '막막', '생각이', '복잡', '답답'],
            responses: [
                "앞날에 대한 걱정과 부담감으로 마음이 많이 조급하고 답답하셨겠어요. 불안함은 그만큼 당신이 이 일을 중요하게 생각한다는 증거이기도 합니다.",
                "아직 일어나지 않은 일들로 스스로를 너무 가두지 않기를 바라요. 당신은 지금까지 수많은 난관을 지혜롭게 헤쳐온 사람입니다."
            ],
            quotes: [
                "바람이 세게 불수록 나무의 뿌리는 땅속 깊이 내려앉습니다.",
                "모든 순간을 완벽하게 통제하지 않아도 괜찮아요. 당신은 이미 잘 해내고 있습니다."
            ],
            recommendations: [
                "4초간 숨을 들이쉬고 7초간 멈춘 뒤 8초간 천천히 내쉬는 4-7-8 호흡법을 3회 반복해보세요. 🧘‍♀️",
                "머릿속을 가득 채운 걱정 목록을 종이에 적고, 지금 당장 해결할 수 없는 건 찢어버려 보세요. 📝"
            ],
            baseEnergy: 40
        },
        {
            key: 'sadness',
            name: '💧 슬픔 & 헛헛함',
            color: '#60a5fa',
            keywords: ['슬픈', '슬펐', '눈물', '우울', '아쉽', '상처', '외롭', '서운', '쓸쓸', '마음이 아픈', '서글'],
            responses: [
                "마음 한구석에 남은 마음 아픈 기억이나 쓸쓸함이 깊게 느껴지네요. 슬픈 감정을 억지로 참지 말고 충분히 어루만져 주세요.",
                "상처받고 서운했던 기억도 모두 당신이 진심을 다해 마음을 쏟았기 때문입니다. 그 예쁜 마음이 결코 헛되지 않길 바라요."
            ],
            quotes: [
                "비가 내린 뒤에 땅이 더욱 굳어지듯, 슬픔의 시간 뒤엔 더 깊은 온기가 피어납니다.",
                "당신의 슬픔에 가만히 어깨를 내어주는 따뜻한 위로가 함께하길 간절히 바랍니다."
            ],
            recommendations: [
                "따뜻한 우유나 감성적인 피아노 연주곡을 들으며 감정을 자연스럽게 흘려보내 보세요. 🎵",
                "나를 위해 폭신한 이불 속에서 좋아하는 영화 한 편을 감상해보세요. 🎬"
            ],
            baseEnergy: 35
        },
        {
            key: 'gratitude',
            name: '🥰 감사 & 따뜻함',
            color: '#34d399',
            keywords: ['감사', '고마운', '고맙', '따뜻', '다행', '도움', '함께', '배려', '친절', '감동'],
            responses: [
                "주변 사람들과의 따뜻한 교감 속에서 은은한 온기를 느끼신 하루군요! 감사를 아는 당신의 다정한 마음이 스며있습니다.",
                "일상 속 작은 소중함을 그냥 지나치지 않고 고마움으로 간직하는 당신은 참 다정하고 멋진 사람입니다."
            ],
            quotes: [
                "감사하는 마음은 일상의 작은 순간도 빛나는 기적으로 만들어 줍니다.",
                "당신이 보낸 따뜻한 마음은 다시 더 큰 행복이 되어 돌아올 것입니다."
            ],
            recommendations: [
                "오늘 고마웠던 사람에게 작은 감사 메시지를 하나 전달해보는 건 어떨까요? 💌",
                "오늘 느꼈던 감사한 일 3가지를 일기장에 포인트로 적어두어 보세요! ✨"
            ],
            baseEnergy: 85
        },
        {
            key: 'calm',
            name: '🌿 평온 & 여유',
            color: '#a7f3d0',
            keywords: ['평온', '여유', '조용', '휴식', '산책', '생각', '소소', '무난', '평범', '고요'],
            responses: [
                "특별한 풍파 없이 차분하고 여유롭게 흘러간 참 평화로운 하루였군요. 잔잔한 호수 같은 시간이 마음의 큰 힘이 되어줍니다.",
                "소소하지만 평온한 일상의 순간들이 모여 삶의단단한 기둥이 됩니다. 오늘 누린 여유를 마음껏 만끽하세요."
            ],
            quotes: [
                "고요함 속에서 가장 맑은 생각이 피어납니다.",
                "평범해서 더욱 특별한 오늘의 평온함을 마음 가득 누리세요."
            ],
            recommendations: [
                "가벼운 산책을 하며 솔솔 불어오는 바람과 하늘의 색을 감상해보세요. 🍃",
                "좋아하는 책 한 권을 펴고 따뜻한 차와 함께 차분한 독립 음악을 들어보세요. 📖"
            ],
            baseEnergy: 75
        }
    ];

    function generateAIEmotionResponse(text) {
        let maxMatches = 0;
        let detectedEmotion = emotionDictionary[5]; // Default: Calm

        emotionDictionary.forEach(emotion => {
            let count = 0;
            emotion.keywords.forEach(kw => {
                if (text.includes(kw)) count++;
            });
            if (count > maxMatches) {
                maxMatches = count;
                detectedEmotion = emotion;
            }
        });

        // Select random response & quote from matching emotion category
        const responseIdx = Math.floor(Math.random() * detectedEmotion.responses.length);
        const quoteIdx = Math.floor(Math.random() * detectedEmotion.quotes.length);
        const recIdx = Math.floor(Math.random() * detectedEmotion.recommendations.length);

        // Generate custom tailored AI response letter
        const firstSentence = text.length > 30 ? text.substring(0, 30) + '...' : text;
        const fullAiBody = `"[${firstSentence}]"\n\n${detectedEmotion.responses[responseIdx]}\n\n오늘 밤은 마음의 부담을 내려놓고 스스로에게 칭찬 한마디를 건네보세요. 당신의 하루는 그 자체로 귀하고 의미 있었습니다.`;

        // Calculate slight variance for score
        const variance = Math.floor(Math.random() * 11) - 5;
        const energyScore = Math.min(100, Math.max(20, detectedEmotion.baseEnergy + variance));

        return {
            emotionName: detectedEmotion.name,
            emotionColor: detectedEmotion.color,
            aiText: fullAiBody,
            quote: detectedEmotion.quotes[quoteIdx],
            recommendation: detectedEmotion.recommendations[recIdx],
            energyScore: energyScore
        };
    }

    function displayAIResult(result, originalText) {
        // Hide initial placeholder text
        placeholderText.style.display = 'none';
        
        // Populate Dynamic AI Content
        primaryEmotionPill.textContent = `감정: ${result.emotionName}`;
        scorePill.textContent = `마음 에너지: ${result.energyScore}%`;
        
        aiTextBody.textContent = result.aiText;
        quoteText.textContent = result.quote;
        recDetail.textContent = result.recommendation;

        // Show Response Content Container
        responseContent.style.display = 'flex';
        responseBox.classList.add('has-content');

        // Scroll smooth to result if needed
        responseBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* ==========================================================================
       5. Serverless Redis History Fetching & Card Rendering
       ========================================================================== */
    async function loadHistoryFromRedis() {
        try {
            const authHeaders = await getAuthHeader();

            let response = await fetch('/api/history', {
                headers: {
                    ...authHeaders
                }
            }).catch(() => null);

            if (!response || !response.ok) {
                response = await fetch('/api/history.js', {
                    headers: {
                        ...authHeaders
                    }
                }).catch(() => null);
            }

            if (!response || !response.ok) {
                renderHistoryFromLocalStorage();
                return;
            }

            const data = await response.json().catch(() => ({}));
            if (data.success && Array.isArray(data.history) && data.history.length > 0) {
                const items = data.history;
                renderHistoryCards(items);

                // Auto-populate latest entry from Serverless Redis into main view on any device
                const latestEntry = items[0];
                if (latestEntry) {
                    if (latestEntry.originalText && (!diaryInput.value || diaryInput.value.trim() === '')) {
                        diaryInput.value = latestEntry.originalText;
                        charCounter.textContent = `${latestEntry.originalText.length}자`;
                    }
                    if (latestEntry.aiResponse && !responseBox.classList.contains('has-content')) {
                        displayGeminiResponse(latestEntry.aiResponse, latestEntry.originalText || '', false);
                    }
                }
            } else {
                renderHistoryFromLocalStorage();
            }
        } catch (err) {
            console.warn('Redis 히스토리 API 호출 중 오류:', err);
            renderHistoryFromLocalStorage();
        }
    }

    function renderHistoryCards(items) {
        if (!items || items.length === 0) {
            historySection.style.display = 'none';
            return;
        }

        historySection.style.display = 'flex';
        historyCount.textContent = items.length;
        historyList.innerHTML = '';

        items.forEach(item => {
            const dateStr = item.timestamp 
                ? new Date(item.timestamp).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : (item.date || '이전 기록');

            const diaryText = item.originalText || item.text || '(작성된 일기 내용 없음)';
            const aiText = item.aiResponse || item.aiSummary || '(AI 답변 없음)';

            // Parse emotion tag from aiResponse
            let emotionName = item.emotion || '감정 분석';
            const emotionMatch = aiText.match(/감정:\s*([^\n]+)/);
            if (emotionMatch && emotionMatch[1]) {
                emotionName = emotionMatch[1].trim();
            }

            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="history-item-top">
                    <span class="history-item-date">📅 ${dateStr}</span>
                    <span class="history-item-emotion">${escapeHtml(emotionName)}</span>
                </div>
                <div class="history-card-body">
                    <div class="history-section-box history-original-box">
                        <span class="history-box-label">📝 작성 일기</span>
                        <p class="history-box-text">${escapeHtml(diaryText)}</p>
                    </div>
                    <div class="history-section-box history-ai-box">
                        <span class="history-box-label">🤖 AI 공감 답변</span>
                        <p class="history-box-text">${escapeHtml(aiText)}</p>
                    </div>
                </div>
            `;
            historyList.appendChild(div);
        });
    }

    function renderHistoryFromLocalStorage() {
        const localItems = JSON.parse(localStorage.getItem('ai_diary_history') || '[]');
        renderHistoryCards(localItems);
    }

    function saveToHistory(text, result) {
        const newEntry = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            originalText: text,
            aiResponse: typeof result === 'string' ? result : (result.aiText || result.quote || ''),
            emotion: typeof result === 'object' ? (result.emotionName || '감정 기록') : '감정 기록'
        };

        historyData.unshift(newEntry);
        if (historyData.length > 20) historyData.pop();

        localStorage.setItem('ai_diary_history', JSON.stringify(historyData));
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('저장된 일기 기록을 모두 삭제하시겠습니까?')) {
            historyData = [];
            localStorage.removeItem('ai_diary_history');
            renderHistoryCards([]);
        }
    });

    /* ==========================================================================
       6. Supabase Realtime Database Subscription & Chat History
       ========================================================================== */
    const renderedMsgSet = new Set();

    async function loadChatHistoryFromSupabase() {
        if (!supabase) return;
        try {
            let { data, error } = await supabase
                .from('massages')
                .select('*')
                .order('created_at', { ascending: true })
                .limit(100);

            if (error && error.code === 'PGRST205') {
                const res2 = await supabase
                    .from('messages')
                    .select('*')
                    .order('created_at', { ascending: true })
                    .limit(100);
                data = res2.data;
                error = res2.error;
            }

            if (!error && Array.isArray(data)) {
                chatMessagesList.innerHTML = '<div class="chat-system-msg">💬 감정을 나누는 실시간 대화 공간에 입장하셨습니다.</div>';
                renderedMsgSet.clear();

                data.forEach(row => {
                    appendChatMessage({
                        id: row.id,
                        userId: row.user_id,
                        email: row.user_email || row.email,
                        message: row.content || row.conent || '',
                        timestamp: row.created_at
                    });
                });
            }
        } catch (e) {
            console.warn('Supabase 메시지 과거 내역 조회 실패:', e);
        }
    }

    function initRealtimeChat(user) {
        if (!supabase || !user) return;

        if (chatChannel) {
            supabase.removeChannel(chatChannel);
            chatChannel = null;
        }

        // 1) Subscribe to Supabase Postgres INSERT changes for 'massages' and 'messages' tables
        chatChannel = supabase.channel('realtime-db-messages-channel')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'massages' }, (payload) => {
                if (payload && payload.new) {
                    appendChatMessage({
                        id: payload.new.id,
                        userId: payload.new.user_id,
                        email: payload.new.user_email || payload.new.email,
                        message: payload.new.content || payload.new.conent || '',
                        timestamp: payload.new.created_at
                    }, user.id);
                }
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                if (payload && payload.new) {
                    appendChatMessage({
                        id: payload.new.id,
                        userId: payload.new.user_id,
                        email: payload.new.user_email || payload.new.email,
                        message: payload.new.content || payload.new.conent || '',
                        timestamp: payload.new.created_at
                    }, user.id);
                }
            })
            .on('broadcast', { event: 'chat-msg' }, (payload) => {
                if (payload && payload.payload) {
                    appendChatMessage(payload.payload, user.id);
                }
            });

        chatChannel.subscribe((status) => {
            const onlineBadge = document.getElementById('chatOnlineBadge');
            if (status === 'SUBSCRIBED') {
                if (onlineBadge) onlineBadge.textContent = '⚡ 실시간 연결됨';
            } else if (onlineBadge) {
                onlineBadge.textContent = '🔌 연결 대기 중';
            }
        });

        // 3) Preload existing chat history on page open
        loadChatHistoryFromSupabase();
    }

    async function sendChatMessage(customText) {
        if (!chatInput && !customText) return;
        const text = customText !== undefined ? customText : chatInput.value.trim();
        if (!text || !supabase) return;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) {
                alert('로그인이 필요한 서비스입니다.');
                return;
            }

            if (chatSendBtn) chatSendBtn.disabled = true;

            // 1. Try inserting into Supabase 'massages' table (or fallback 'messages')
            let { error } = await supabase
                .from('massages')
                .insert([
                    {
                        content: text,
                        user_email: user.email
                    }
                ]);

            if (error && error.code === 'PGRST205') {
                const res2 = await supabase
                    .from('messages')
                    .insert([
                        {
                            content: text,
                            user_email: user.email
                        }
                    ]);
                error = res2.error;
            }

            if (chatSendBtn) chatSendBtn.disabled = false;

            if (error) {
                console.error('Supabase DB insert 오류:', error.message);
                showAuthMessage(`[DB 저장 오류] ${error.message}`);
            }

            // 2. Clear input box if customText was not passed
            if (customText === undefined && chatInput) {
                chatInput.value = '';
            }

            // 3. Broadcast message to connected clients
            if (chatChannel) {
                const currentAvatarUrl = (user.user_metadata && user.user_metadata.avatar_url) 
                    || localStorage.getItem(`user_avatar_${user.id}`) 
                    || 'assets/hello_kitty.jpg';

                const msgPayload = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    userId: user.id,
                    email: user.email || '익명 사용자',
                    avatarUrl: currentAvatarUrl,
                    message: text,
                    timestamp: new Date().toISOString()
                };

                await chatChannel.send({
                    type: 'broadcast',
                    event: 'chat-msg',
                    payload: msgPayload
                });
            }
        } catch (err) {
            if (chatSendBtn) chatSendBtn.disabled = false;
            console.warn('채팅 메시지 전송 예외:', err);
        }
    }

    function formatMessageContent(text) {
        if (!text || typeof text !== 'string') return { html: '', isImage: false };

        // Match markdown image syntax: ![image](URL), [image](URL), ![이미지](URL), [이미지](URL)
        const imgMatch = text.match(/^!?\[(?:image|이미지)\]\((.*?)\)$/i);
        if (imgMatch && imgMatch[1]) {
            const imgUrl = imgMatch[1].trim();
            return {
                isImage: true,
                html: `
                    <div class="chat-img-wrapper">
                        <img src="${escapeHtml(imgUrl)}" class="chat-attached-img" alt="첨부 이미지" 
                             onclick="window.open('${escapeHtml(imgUrl)}', '_blank')"
                             onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'chat-img-error\'>⚠️ 이미지를 불러올 수 없습니다</div>';">
                    </div>
                `
            };
        }

        return { isImage: false, html: escapeHtml(text) };
    }

    function appendChatMessage(msgData, myUserId) {
        const messageText = msgData?.message || msgData?.content;
        if (!msgData || !messageText || !chatMessagesList) return;

        // Deduplicate rendered messages by ID or payload key
        const msgKey = msgData.id ? `id_${msgData.id}` : `raw_${msgData.timestamp}_${msgData.email}_${messageText}`;
        if (renderedMsgSet.has(msgKey)) return;
        renderedMsgSet.add(msgKey);

        const currentEmail = userEmailText ? userEmailText.textContent.trim() : '';
        const isMine = (msgData.userId === (myUserId || currentUserId)) || (msgData.email && msgData.email === currentEmail);

        const dateStr = msgData.timestamp 
            ? new Date(msgData.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
            : '';

        const fullEmail = msgData.email || '익명 사용자';
        const avatarUrl = msgData.avatarUrl || msgData.avatar_url || (isMine ? (userAvatarImg ? userAvatarImg.src : 'assets/hello_kitty.jpg') : 'assets/hello_kitty.jpg');

        const formatted = formatMessageContent(messageText);

        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
        
        msgDiv.innerHTML = `
            <div class="chat-msg-sender">
                <img class="chat-msg-avatar" src="${escapeHtml(avatarUrl)}" onerror="this.src='assets/hello_kitty.jpg'" alt="프로필">
                <span>${isMine ? '나' : escapeHtml(fullEmail)}</span>
            </div>
            <div class="chat-msg-bubble ${formatted.isImage ? 'has-image-bubble' : ''}">${formatted.html}</div>
            <div class="chat-msg-time">${dateStr}</div>
        `;

        chatMessagesList.appendChild(msgDiv);
        if (chatMessagesContainer) {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    }

    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendChatMessage();
        });
    }

    // Clip Icon Button -> Select Chat Image File
    if (chatClipBtn) {
        chatClipBtn.addEventListener('click', () => {
            if (chatImageFileInput) chatImageFileInput.click();
        });
    }

    if (chatImageFileInput) {
        chatImageFileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file || !supabase) return;

            try {
                const { data: { session } } = await supabase.auth.getSession();
                const user = session?.user;
                if (!user) {
                    alert('로그인이 필요한 서비스입니다.');
                    return;
                }

                if (chatClipBtn) chatClipBtn.disabled = true;

                // 1. Upload image file to Supabase Storage 'chat-images' bucket
                const fileExt = file.name.split('.').pop() || 'png';
                const filePath = `${user.id}/chat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${fileExt}`;

                const { data, error } = await supabase.storage
                    .from('chat-images')
                    .upload(filePath, file, { upsert: true });

                if (chatClipBtn) chatClipBtn.disabled = false;

                if (error) {
                    console.error('Supabase chat-images storage upload error:', error.message);
                    showAuthMessage(`[이미지 업로드 오류] ${error.message}`);
                    return;
                }

                // 2. Get Public URL
                const { data: { publicUrl } } = supabase.storage
                    .from('chat-images')
                    .getPublicUrl(filePath);

                if (publicUrl) {
                    // 3. Store formatted string ![image](URL) into DB & send to chat
                    const formattedImageContent = `![image](${publicUrl})`;
                    await sendChatMessage(formattedImageContent);
                }

                // Reset file input
                chatImageFileInput.value = '';

            } catch (err) {
                if (chatClipBtn) chatClipBtn.disabled = false;
                console.warn('chat-images storage upload exception:', err);
            }
        });
    }

    /* ==========================================================================
       7. Profile Avatar Selection & Supabase Storage Upload
       ========================================================================== */
    if (avatarClickArea) {
        avatarClickArea.addEventListener('click', () => {
            if (avatarFileInput) avatarFileInput.click();
        });
    }

    if (changePhotoBtn) {
        changePhotoBtn.addEventListener('click', () => {
            if (avatarFileInput) avatarFileInput.click();
        });
    }

    if (avatarFileInput) {
        avatarFileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            // ① Upload file to Supabase Storage 'avatars' bucket (path: user_id/avatar.png)
            if (supabase && currentUserId) {
                const fileExt = file.name.split('.').pop() || 'png';
                const filePath = `${currentUserId}/avatar.${fileExt}`;

                try {
                    const { data, error } = await supabase.storage
                        .from('avatars')
                        .upload(filePath, file, { upsert: true });

                    if (!error) {
                        // ② Get Public URL
                        const { data: { publicUrl } } = supabase.storage
                            .from('avatars')
                            .getPublicUrl(filePath);

                        if (publicUrl) {
                            const freshUrl = `${publicUrl}?t=${Date.now()}`;

                            // ③ Save Public URL into Supabase Auth User Metadata (user_metadata.avatar_url)
                            await supabase.auth.updateUser({
                                data: { avatar_url: freshUrl }
                            });

                            // ④ Immediately update screen profile image
                            if (userAvatarImg) userAvatarImg.src = freshUrl;
                            localStorage.setItem(`user_avatar_${currentUserId}`, freshUrl);
                        }
                    } else {
                        console.warn('Supabase storage upload error:', error.message);
                    }
                } catch (err) {
                    console.warn('Storage upload exception:', err);
                }
            }
        });
    }

    // Load history on page load
    loadHistoryFromRedis();
});
