/**  Copyright (c) Manuel Lõhmus (MIT License). */

if ('serviceWorker' in navigator) {

    var script = this.document && Array.from(document.scripts).find(function (s) { return s.src.includes('tiny-https-server'); }),
        isDebug = Boolean(script?.attributes.debug) || false,
        updateInterval = parseInt(script?.attributes?.updateInterval?.value) || 300000, // default 5min.
        disableUpdateDialogs = Boolean(script?.attributes.disableUpdateConfirmDialogs) || false,
        dataUrl = script?.attributes?.dataUrl?.value || '';

    if (updateInterval < 10000) { updateInterval = 10000; }

    navigator.serviceWorker.register('/service_worker.js', { scope: '/' })
        .then(function (registration) {

            pDebug('Service Worker registered successfully:', registration.scope);

            var worker = registration.installing || registration.waiting || registration.active;

            if (worker) {

                serviceWorkerState(worker.state);

                worker.addEventListener('statechange', function (event) {

                    serviceWorkerState(event.target.state);
                });
            }
        })
        .catch(function (error) {

            pError('Service Worker registration failed:', error);
        });

    navigator.serviceWorker.addEventListener('message', onmessage);
}


function serviceWorkerState(state) {

    pDebug('Service Worker state:', state);

    if (state === 'activated') {

        checkForServiceWorkerUpdate();
    }

    if (window.datacontext) {

        if (!window.datacontext.serviceWorker) { window.datacontext.serviceWorker = {}; }
        window.datacontext.serviceWorker.state = state;
    }
}
function checkForServiceWorkerUpdate() {

    if (!window.datacontext?.isWsOnline) {

        if (updateInterval > -1) {

            setTimeout(checkForServiceWorkerUpdate, updateInterval);
        }
        return;
    }

    pDebug('Checking for Service Worker update...', 'Update Interval:', updateInterval, 'ms');

    navigator.serviceWorker.ready
        .then(registration => {

            registration.update().then(function () {

                if (updateInterval > -1) {

                    setTimeout(checkForServiceWorkerUpdate, updateInterval);
                }
            });
        });
}
function requestReload() {

    if (!disableUpdateDialogs) {

        if (confirm('New content available.\nAre we upgrading now?')) {

            location.reload();
        }
        else {

            setTimeout(requestReload, 300000); // 5min.
        }
    }
}
function onmessage(event) {

    pDebug('Message received from Service Worker:', event.data);

    window.dispatchEvent(new CustomEvent('tiny-https-server', { detail: event.data }));

    if (window.datacontext) {

        if (!window.datacontext.serviceWorker) { window.datacontext.serviceWorker = {}; }
        window.datacontext.serviceWorker.state = event.target.state;
        window.datacontext.serviceWorker.message = event.data;
    }

    var { type, url, version } = event.data;

    if (type === "NEW_CONTENT") {

        if (url.endsWith('.html')) {

            onmessage.reload = true;
        }

        if (dataUrl && url.endsWith(dataUrl) && window.modules?.['data-context-binding']?.loadDataUrl) {

            window.modules['data-context-binding'].loadDataUrl(dataUrl);
        }
    }

    if (type === "PRECACHE_COMPLETE") {

        pDebug('Precache complete for version:', version);

        if (onmessage.reload) {

            delete onmessage.reload;
            requestReload();
        }
    }
}

// Debugging
function pDebug(...args) { if (isDebug) { console.log(`[ DEBUG ] `, ...args); } }
function pError(...args) { if (isDebug) { console.error(`[ ERROR ] `, ...args); } }