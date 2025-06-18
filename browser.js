/**  Copyright (c) Manuel Lõhmus (MIT License). */

if ('serviceWorker' in navigator) {

    var script = this.document && Array.from(document.scripts).find(function (s) { return s.src.includes('tiny-https-server'); }),
        isDebug = Boolean(script?.attributes.debug) || false,
        updateInterval = parseInt(script?.attributes?.updateInterval?.value) || 300000, // default 5min.
        disableUpdateDialogs = Boolean(script?.attributes.disableUpdateDialogs) || false,
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

            registration.update()
                .then(function () {

                    if (updateInterval > -1) {

                        setTimeout(checkForServiceWorkerUpdate, updateInterval);
                    }
                })
                .catch(function (error) {
                    pError('Service Worker update failed:', error);
                    requestReload();
                });
        });
}
function requestReload() {

    if (onmessage.newInstall) {

        delete onmessage.newInstall;
        delete onmessage.reload;

        return;
    }

    window.dispatchEvent(new CustomEvent('tinyHttpsServe', { detail: { type: 'REQUEST_RELOAD' } }));

    if (!disableUpdateDialogs) {

        if (confirm('New content available.\nAre we upgrading now?')) {

            delete onmessage.reload;
            location.reload();
        }
        else {

            setTimeout(requestReload, 300000); // 5min.
        }
    }
}
function onmessage(event) {

    pDebug('Message received from Service Worker:', event.data);

    window.dispatchEvent(new CustomEvent('tinyHttpsServe', { detail: event.data }));

    var { type, url, version, error } = event.data;


    if (type === "PRECACHE_EMPTY") {

        onmessage.newInstall = true;
    }

    if (type === "PRECACHE_NEW_CONTENT") {

        if (url === '/index.html'
            || url.endsWith('.js')
            || url.endsWith('.css')
            || url.startsWith('/node_modules/')
            || url.endsWith('.html') && findTemplateElement(url)) {

            onmessage.reload = true;
        }

        if (dataUrl && url.endsWith(dataUrl) && window.modules?.['data-context-binding']?.loadDataUrl) {

            window.modules['data-context-binding'].loadDataUrl(dataUrl);
        }
    }

    if (type === "PRECACHE_ERROR") {

        pError('Precache error for URL:', url, 'Version:', version, 'Error:', error);

        if (confirm('Precache error occurred.\nDo you want to reload the page?')) {

            location.reload();
        }
    }

    if (type === "PRECACHE_COMPLETE") {

        pDebug('Precache complete for version:', version);

        if (onmessage.reload) {

            requestReload();
        }
    }
} function findTemplateElement(url) {

    var elems = document.querySelectorAll('[template]'),
        elem = elems ? Array.from(elems).find(function (el) { return url.includes(el.attributes.template.value); }) : null;

    if (elem) { return elem }

    elems = document.querySelectorAll('[templates]');
    elem = elems ? Array.from(elems).find(function (el) { return url.includes(el.attributes.templates.value); }) : null;

    return elem;
} 

// Debugging
function pDebug(...args) { if (isDebug) { console.log(`[ DEBUG ] `, ...args); } }
function pError(...args) { if (isDebug) { console.error(`[ ERROR ] `, ...args); } }