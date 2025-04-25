/**  Copyright (c) Manuel Lõhmus (MIT License). */

if ('serviceWorker' in navigator) {

    // Check for updates every 5 minutes.
    setInterval(function () {

        navigator.serviceWorker.ready
            .then(registration => { registration.update(); });

    }, 300000); // 5min.

    navigator.serviceWorker.register('/service_worker.js', { scope: '/' }).then((registration) => {

        if (registration?.installing?.state === "installing") {
            
            navigator.serviceWorker.ready.then(registration => {

                registration.update()
                    .then(() => {

                        if (confirm('Progressive Web App updated successfully.\nA reload is required to launch the new version.')) {

                            location.reload();
                        }
                        console.log('Service Worker updated successfully.');
                    })
                    .catch(error => {

                        //alert('Progressive Web App update failed:', error);
                        //console.error('Service Worker update failed:', error);
                    });
            });
        }
    });

    if (navigator.serviceWorker.controller) {

        navigator.serviceWorker.controller.addEventListener('statechange', function (e) {

            if (e.target.state === 'redundant') {

                if (confirm('Progressive Web App new version.\nA reload is required to launch the new version.')) {

                    location.reload();
                }
            }
        });
    }
}