'use strict';

if ('serviceWorker' in navigator) {

    navigator.serviceWorker.register('/service_worker.js');

    if (navigator.serviceWorker.controller) {

        navigator.serviceWorker.controller.addEventListener('statechange', function (e) {

            if (e.target.state === 'redundant') {

                fetch('/$service_worker_version').then(function (response) {

                    response.text().then(function (version) {

                        if (confirm("New version: " + version + "\nReloading is recommended.")) {
                            location.reload();
                        }
                    });
                });
            }
        });
    }
}