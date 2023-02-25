'use strict';

if ('serviceWorker' in navigator) {

    navigator.serviceWorker.register('/service_worker.js');

    if (navigator.serviceWorker.controller) {

        navigator.serviceWorker.controller.addEventListener('statechange', function (e) {

            if (e.target.state === 'redundant') {

                if (isChecked) {
                    if (confirm("New version: " + localStorage.getItem('version') + "\nReloading is recommended.")) {
                        location.reload();
                    }
                }
                else {
                    isChecked = true;
                    location.reload();
                }
            }
        });
    }
}

function checkServiceWorkerVersion() {

    function GET(url, callback) {

        if (url && url !== "null") {

            var xmlhttp = window.XMLHttpRequest ? new XMLHttpRequest() : new window.ActiveXObject("Microsoft.XMLHTTP");
            xmlhttp.open("GET", url);
            xmlhttp.onload = function () {

                if (typeof callback === "function")
                    callback(xmlhttp.responseText, xmlhttp.status);
            };
            xmlhttp.send();
        }
    }

    function updateServiceWorker() {

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service_worker.js').then(function (reg) { reg.update(); });
        }
    }

    GET('/$service_worker_version', function (version) {

        if (localStorage.getItem('version') !== version) {
            localStorage.setItem('version', version);
            updateServiceWorker();
        }
        else {
            isChecked = true;
        }
    })
}

var isChecked = false;
checkServiceWorkerVersion();