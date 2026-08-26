// Environment configuration helper for local execution
if (!window.GEMINI_API_KEY) {
    window.GEMINI_API_KEY = localStorage.getItem('GEMINI_API_KEY') || '';
}
