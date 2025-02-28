/**  Copyright (c) 2024, Manuel Lõhmus (MIT License). */

if ('serviceWorker' in navigator) {

    navigator.serviceWorker.register('/service_worker.js');

    if (navigator.serviceWorker.controller) {

        navigator.serviceWorker.controller.addEventListener('statechange', function (e) {

            if (e.target.state === 'redundant') {

                if (confirm('Progressive Web App new version.\nReloading is recommended.')) {

                    location.reload();
                }
            }
        });
    }
}