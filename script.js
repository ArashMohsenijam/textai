// Elements
const textInput = document.getElementById('textInput');
const voiceSelect = document.getElementById('voiceSelect');
const convertBtn = document.getElementById('convertBtn');
const audioPlayer = document.getElementById('audioPlayer');
const buttonText = convertBtn.querySelector('.button-text');
const audioInput = document.getElementById('audioInput');
const audioToTextBtn = document.getElementById('audioToTextBtn');
const languageSelect = document.getElementById('languageSelect');

// API Configuration
const OPENAI_API_KEY = ''; // Remove API key before pushing to GitHub

// Function to get API key from user
function getApiKey() {
    const savedKey = localStorage.getItem('openai_api_key');
    if (savedKey) {
        return savedKey;
    }
    
    const key = prompt('Please enter your OpenAI API key:');
    if (key) {
        localStorage.setItem('openai_api_key', key);
        return key;
    }
    return null;
}

// Usage tracking in localStorage
const usageKey = 'api_usage';
const getUsage = () => {
    const usage = localStorage.getItem(usageKey);
    return usage ? JSON.parse(usage) : {
        count: 0,
        lastReset: Date.now(),
        dailyLimit: 50  // Adjust this based on your API plan
    };
};

const updateUsage = () => {
    const usage = getUsage();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Reset counter if it's a new day
    if (now - usage.lastReset > oneDayMs) {
        usage.count = 0;
        usage.lastReset = now;
    }

    usage.count++;
    localStorage.setItem(usageKey, JSON.stringify(usage));
    return usage;
};

const checkUsageLimit = () => {
    const usage = getUsage();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Reset if it's a new day
    if (now - usage.lastReset > oneDayMs) {
        return true;
    }

    return usage.count < usage.dailyLimit;
};

// Queue system
const requestQueue = [];
let isProcessing = false;

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000, // 1 second
    maxDelay: 60000, // 1 minute
    backoffFactor: 2
};

// Retry function with exponential backoff
async function retryWithBackoff(operation, retryCount = 0) {
    try {
        return await operation();
    } catch (error) {
        if (retryCount >= RETRY_CONFIG.maxRetries) {
            throw error;
        }

        const delay = Math.min(
            RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffFactor, retryCount),
            RETRY_CONFIG.maxDelay
        );

        console.log(`Retry attempt ${retryCount + 1}. Waiting ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));

        return retryWithBackoff(operation, retryCount + 1);
    }
}

// API request function with retry logic
async function makeAPIRequest(text, voice) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('No API key found');
    }

    return retryWithBackoff(async () => {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'audio/mpeg'
            },
            body: JSON.stringify({
                model: 'tts-1',
                input: text,
                voice: voice,
                response_format: 'mp3'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After');
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                showError(`Rate limit reached. Retrying in ${Math.ceil(waitTime/1000)} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                throw new Error('Rate limit reached');
            }
            throw new Error(errorData.error?.message || 'API Error');
        }

        return response;
    });
}

// Function to convert audio to text using OpenAI API
async function convertAudioToText(audioFile, language) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('No API key found');
    }

    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('model', 'whisper-1');
    formData.append('language', language);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`
        },
        body: formData
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'API Error');
    }

    const data = await response.json();
    return data.text;
}

// Show error with custom styling
const showError = (message, type = 'error') => {
    const errorDiv = document.createElement('div');
    errorDiv.className = `message-box ${type}`;
    errorDiv.innerHTML = `
        <div class="message-content">
            <span class="message-icon">${type === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span class="message-text">${message}</span>
        </div>
    `;
    convertBtn.parentElement.appendChild(errorDiv);
    
    errorDiv.classList.add('show');
    setTimeout(() => {
        errorDiv.classList.add('fade-out');
        setTimeout(() => errorDiv.remove(), 300);
    }, 5000);
};

// Process queue with rate limiting
const processQueue = async () => {
    if (isProcessing || requestQueue.length === 0) return;
    
    isProcessing = true;
    const request = requestQueue[0];
    
    try {
        if (!checkUsageLimit()) {
            const usage = getUsage();
            const resetTime = new Date(usage.lastReset + 24 * 60 * 60 * 1000);
            throw new Error(`Daily limit reached. Resets at ${resetTime.toLocaleTimeString()}`);
        }

        const response = await makeAPIRequest(request.text, request.voice);
        const audioBlob = await response.blob();
        audioPlayer.style.opacity = '0';
        audioPlayer.src = URL.createObjectURL(audioBlob);
        audioPlayer.style.display = 'block';
        audioPlayer.offsetHeight;
        audioPlayer.style.opacity = '1';
        audioPlayer.style.transition = 'opacity 0.3s ease-in-out';
        
        request.resolve();
        showError('Conversion successful!', 'success');
    } catch (error) {
        console.error('Error:', error);
        showError(error.message);
        request.reject(error);
    } finally {
        requestQueue.shift();
        isProcessing = false;
        setTimeout(processQueue, 2000); // Add delay between requests
    }
};

// Convert button click handler
convertBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) {
        textInput.classList.add('shake');
        setTimeout(() => textInput.classList.remove('shake'), 600);
        return;
    }

    // Update button state
    convertBtn.disabled = true;
    buttonText.innerHTML = '<span class="loading"></span> Converting...';

    try {
        await new Promise((resolve, reject) => {
            requestQueue.push({
                text,
                voice: voiceSelect.value,
                resolve,
                reject
            });
            processQueue();
        });
    } catch (error) {
        console.error('Full error:', error);
    } finally {
        buttonText.style.opacity = '0';
        setTimeout(() => {
            buttonText.innerHTML = 'Convert to Speech';
            buttonText.style.opacity = '1';
            convertBtn.disabled = false;
        }, 300);
    }
});

// Audio to Text button click handler
audioToTextBtn.addEventListener('click', async () => {
    const audioFile = audioInput.files[0];
    const language = languageSelect.value;
    if (!audioFile) {
        showError('Please select an audio file to convert.');
        return;
    }

    try {
        const transcribedText = await convertAudioToText(audioFile, language);
        textInput.value = transcribedText;
        showError('Audio converted to text successfully!', 'success');
    } catch (error) {
        console.error('Error:', error);
        showError(error.message);
    }
});

// Add smooth scroll behavior
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
    });
});

// Add input animations
textInput.addEventListener('focus', () => {
    textInput.parentElement.classList.add('focused');
});

textInput.addEventListener('blur', () => {
    textInput.parentElement.classList.remove('focused');
});
