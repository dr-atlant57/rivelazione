/**
 * 20_frontend.js_v1.1_Production
 * Экосистема: rivelazione.org // Платформа: Anthroponomy
 * Модуль: Intake Runtime Engine (Клиентский слой интейк-контура)
 */

const AnthroponomyStates = {
    INIT: 'INIT',
    CALIBRATION: 'CALIBRATION',
    STE: 'STE',
    ROUTE: 'ROUTE',
    SNAPSHOT: 'SNAPSHOT',
    COMPLETED: 'COMPLETED'
};

class AnthroponomyStateMachine {
    constructor(initialState = AnthroponomyStates.INIT) {
        this.currentState = initialState;
        this.transitions = {
            [AnthroponomyStates.INIT]: [AnthroponomyStates.CALIBRATION],
            [AnthroponomyStates.CALIBRATION]: [AnthroponomyStates.STE],
            [AnthroponomyStates.STE]: [AnthroponomyStates.ROUTE],
            [AnthroponomyStates.ROUTE]: [AnthroponomyStates.SNAPSHOT],
            [AnthroponomyStates.SNAPSHOT]: [AnthroponomyStates.COMPLETED],
            [AnthroponomyStates.COMPLETED]: []
        };
    }

    transition(toState) {
        if (this.transitions[this.currentState].includes(toState)) {
            console.log(`[Anthroponomy State]: ${this.currentState} -> ${toState}`);
            this.currentState = toState;
            return true;
        }
        console.error(`[Anthroponomy State Error]: Invalid transition ${this.currentState} -> ${toState}`);
        return false;
    }
}

class EvidenceCore {
    constructor() {
        this.evidence = {
            speech_supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
            speech_used: false,
            speech_duration_ms: 0,
            manual_edit_count: 0,
            completion_mode: "pure_text"
        };

        this.responseProfile = {
            word_count: 0,
            sentence_count: 0,
            avg_sentence_length: 0,
            response_duration_ms: 0,
            time_to_first_word_ms: 0
        };

        this.researchProfile = {
            pause_ms: 0,
            restart_count: 0,
            abandon_count: 0,
            correction_density: 0,
            silence_segments: []
        };

        this.timeline = [];
        this.lastEventTime = performance.now();
    }

    logEvent(type, metadata = {}) {
        const now = performance.now();
        const delta = now - this.lastEventTime;
        this.lastEventTime = now;

        const event = { type, timestamp: now, delta, ...metadata };
        this.timeline.push(event);

        if (type === 'speech_segment_started' && delta > 2000) {
            this.researchProfile.restart_count++;
            this.researchProfile.silence_segments.push({ duration: delta });
            this.researchProfile.pause_ms += delta;
        }
    }

    profileTextStructure(text) {
        const trimmed = text.trim();
        if (!trimmed) return;

        const words = trimmed.split(/\s+/).filter(w => w.length > 0);
        const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 0);

        this.responseProfile.word_count = words.length;
        this.responseProfile.sentence_count = sentences.length;
        this.responseProfile.avg_sentence_length = sentences.length ? parseFloat((words.length / sentences.length).toFixed(1)) : 0;
    }

    exportPayload() {
        return {
            Evidence: { ...this.evidence },
            Response_Profile: { ...this.responseProfile },
            Research_Profile: { ...this.researchProfile }
        };
    }
}

class VoiceEngine {
    constructor(onBufferUpdateCallback, evidenceInstance) {
        this.evidence = evidenceInstance;
        this.onBufferUpdate = onBufferUpdateCallback;
        
        this.recognition = null;
        this.isStarted = false;
        this.shouldContinue = false;
        this.finalTranscriptBuffer = ''; 
        this.sessionStartTime = null;

        this.initSpeechAPI();
    }

    initSpeechAPI() {
        const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechClass) {
            this.evidence.evidence.speech_supported = false;
            return;
        }

        this.recognition = new SpeechClass();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'ru-RU';

        this.initListeners();
    }

    initListeners() {
        this.recognition.onstart = () => {
            this.isStarted = true;
            this.evidence.evidence.speech_used = true;
            if (!this.sessionStartTime) {
                this.sessionStartTime = performance.now();
            }
            this.evidence.logEvent('engine_started');
        };

        this.recognition.onresult = (event) => {
            const now = performance.now();
            if (!this.evidence.responseProfile.time_to_first_word_ms && this.sessionStartTime) {
                this.evidence.responseProfile.time_to_first_word_ms = parseFloat((now - this.sessionStartTime).toFixed(0));
            }

            let interimTranscript = '';
            this.evidence.logEvent('speech_segment_processing');

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    this.finalTranscriptBuffer += event.results[i][0].transcript + ' ';
                    this.evidence.logEvent('speech_segment_started');
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            this.onBufferUpdate(this.finalTranscriptBuffer + interimTranscript);
        };

        this.recognition.onerror = (event) => {
            console.error(`[Voice Engine Critical Error]: ${event.error}`);
            this.evidence.logEvent('engine_error', { reason: event.error });
            if (event.error === 'no-speech') {
                this.evidence.researchProfile.abandon_count++;
            }
        };

        this.recognition.onend = () => {
            this.isStarted = false;
            if (this.shouldContinue) {
                this.evidence.logEvent('engine_watchdog_recovered');
                this.restartTimeout = setTimeout(() => {
                    if (this.shouldContinue && !this.isStarted) {
                        try { this.recognition.start(); } catch(e) { console.error(e); }
                    }
                }, 150);
            } else {
                this.evidence.logEvent('engine_stopped_normally');
            }
        };
    }

    start() {
        if (!this.recognition) return false;
        this.shouldContinue = true;
        if (!this.isStarted) {
            this.recognition.start();
        }
        return true;
    }

    stop() {
        this.shouldContinue = false;
        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        if (this.recognition && this.isStarted) {
            this.recognition.stop();
        }
        if (this.sessionStartTime) {
            this.responseProfile = this.evidence.responseProfile;
            this.responseProfile.response_duration_ms = parseFloat((performance.now() - this.sessionStartTime).toFixed(0));
        }
    }

    clear() {
        this.finalTranscriptBuffer = '';
        this.sessionStartTime = null;
    }
}

class APIBroker {
    constructor(workerUrl) {
        this.workerUrl = workerUrl;
    }

    async acquireSessionServerSide(participantId, studyId, correlationId) {
        const payload = {
            Contract_Version: "17_API_Contract_v1.1",
            Frontend_Version: "20_frontend_v1.1_Production",
            Request_ID: crypto.randomUUID(),
            Correlation_ID: correlationId,
            Action: "INIT_SESSION",
            Participant_ID: participantId,
            Study_ID: studyId,
            Timestamp: new Date().toISOString()
        };

        try {
            const response = await fetch(`${this.workerUrl}/session/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`Handshake failed: ${response.status}`);
            const result = await response.json();
            return result.Session_ID; 
        } catch (error) {
            console.error('[API Broker Handshake Error]:', error);
            throw error;
        }
    }

    async dispatch(envelope, maxRetries = 3) {
        let attempt = 0;
        const requestId = envelope.Request_ID;

        while (attempt < maxRetries) {
            try {
                const response = await fetch(`${this.workerUrl}/intake/submit`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-Idempotency-Key': requestId 
                    },
                    body: JSON.stringify(envelope)
                });
                if (!response.ok) throw new Error(`HTTP status ${response.status}`);
                return await response.json();
            } catch (error) {
                attempt++;
                if (attempt >= maxRetries) throw error;
                await new Promise(res => setTimeout(res, 1000 * attempt));
            }
        }
    }
}

class AnthroponomySession {
    constructor(workerUrl, participantId, studyId) {
        this.sm = new AnthroponomyStateMachine();
        this.evidenceCore = new EvidenceCore();
        this.broker = new APIBroker(workerUrl);
        
        this.ids = {
            Participant_ID: participantId,
            Study_ID: studyId,
            Correlation_ID: crypto.randomUUID(),
            Session_ID: null 
        };

        this.voiceEngine = new VoiceEngine((bufferedText) => {
            if (this.ui) this.ui.renderInput(bufferedText);
        }, this.evidenceCore);
    }

    async initializeRuntime() {
        this.ids.Session_ID = await this.broker.acquireSessionServerSide(
            this.ids.Participant_ID, 
            this.ids.Study_ID, 
            this.ids.Correlation_ID
        );
        this.sm.transition(AnthroponomyStates.CALIBRATION);
    }

    async submitAnswer(questionId, textFromUI) {
        this.voiceEngine.stop();
        this.evidenceCore.profileTextStructure(textFromUI);

        if (this.evidenceCore.evidence.speech_used) {
            this.evidenceCore.evidence.completion_mode = 
                this.evidenceCore.researchProfile.correction_density > 0 || this.evidenceCore.evidence.manual_edit_count > 0
                ? "voice_plus_edit" 
                : "pure_voice";
        }

        const envelope = {
            Contract_Version: "17_API_Contract_v1.1",
            Frontend_Version: "20_frontend_v1.1_Production",
            Request_ID: crypto.randomUUID(), 
            Correlation_ID: this.ids.Correlation_ID,
            Session_ID: this.ids.Session_ID,
            Study_ID: this.ids.Study_ID,
            Participant_ID: this.ids.Participant_ID,
            Payload: {
                Question_ID: questionId,
                Data: textFromUI,
                Timestamp: new Date().toISOString()
            },
            Metadata: {
                State: this.sm.currentState,
                ...this.evidenceCore.exportPayload()
            }
        };

        const response = await this.broker.dispatch(envelope);
        this.voiceEngine.clear();
        return response;
    }
}

class UIEngine {
    constructor(sessionInstance) {
        this.session = sessionInstance;
        this.session.ui = this;
        
        this.inputArea = document.getElementById('anthroponomy-input');
        this.submitBtn = document.getElementById('anthroponomy-submit');
        this.recBtn = document.getElementById('anthroponomy-rec');
        
        this.initEvents();
        this.checkVoiceSupport();
    }

    checkVoiceSupport() {
        if (!this.session.voiceEngine.recognition) {
            this.recBtn.disabled = true;
            this.recBtn.textContent = 'Голосовой ввод недоступен';
            this.recBtn.style.opacity = '0.5';
        }
    }

    initEvents() {
        this.recBtn.addEventListener('click', () => {
            const success = this.session.voiceEngine.start();
            if (success) {
                this.recBtn.textContent = '● Анализ речевого потока...';
            }
        });

        this.inputArea.addEventListener('input', () => {
            this.session.evidenceCore.evidence.manual_edit_count++;
            this.session.evidenceCore.researchProfile.correction_density = 
                parseFloat((this.session.evidenceCore.evidence.manual_edit_count / Math.max(this.inputArea.value.length, 1)).toFixed(3));
            this.session.evidenceCore.logEvent('ui_manual_edit');
        });

        this.submitBtn.addEventListener('click', async () => {
            const currentQuestionId = this.inputArea.dataset.questionId;
            const text = this.inputArea.value;
            
            this.recBtn.textContent = 'Активировать микрофон';
            this.submitBtn.disabled = true;
            try {
                await this.session.submitAnswer(currentQuestionId, text);
                this.inputArea.value = '';
            } finally {
                this.submitBtn.disabled = false;
            }
        });
    }

    renderInput(text) {
        if (this.inputArea) {
            this.inputArea.value = text;
        }
    }
}

window.AnthroponomyRuntime = {
    launch: async (workerUrl, participantId, studyId) => {
        const session = new AnthroponomySession(workerUrl, participantId, studyId);
        await session.initializeRuntime();
        new UIEngine(session);
        return session;
    }
};
