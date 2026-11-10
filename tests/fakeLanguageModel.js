// A stand-in for Chrome's built-in `LanguageModel` (Prompt API), injected with
// page.addInitScript, so the AI plumbing can be tested deterministically.
// Configure via window.fakeAI = {availability, respond(promptText) => string}.
// Every call is recorded in window.aiCalls.
(() => {
    window.aiCalls = [];
    window.fakeAI = {
        availability: 'available',
        respond: () => '{}',
    };
    class FakeSession {
        constructor(options){
            this.options = options;
        }
        async prompt(input, options = {}){
            window.aiCalls.push({method: 'prompt', input, responseConstraint: options.responseConstraint});
            return window.fakeAI.respond(input);
        }
        destroy(){
            window.aiCalls.push({method: 'destroy'});
        }
    }
    window.LanguageModel = {
        async availability(options){
            window.aiCalls.push({method: 'availability', options});
            return window.fakeAI.availability;
        },
        async create(options = {}){
            const {monitor, signal, ...rest} = options;
            window.aiCalls.push({method: 'create', options: rest});
            if(monitor){
                const target = new EventTarget();
                monitor(target);
                const progress = new Event('downloadprogress');
                progress.loaded = 1;
                target.dispatchEvent(progress);
            }
            return new FakeSession(rest);
        },
    };
})();
