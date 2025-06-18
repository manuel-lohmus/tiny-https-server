var VERSION = '${service_worker_version}',
    RUNTIME = 'runtime',
    PRECACHE = 'precache',
    PRECACHE_URLS = [//${ str_url_list }
    ];

// Install event: cache files
self.addEventListener('install', function (event) {

    event.waitUntil(
        caches.open(PRECACHE).then(function (cache) {

            var i = -1;

            cache.keys()
                .then(function (keys) {

                    if (!keys.length) {

                        postMessage({ type: 'PRECACHE_EMPTY', version: VERSION });
                    }

                    next();
                });

            function next() {

                i++;

                if (i >= PRECACHE_URLS.length) {

                    postMessage({ type: 'PRECACHE_COMPLETE', version: VERSION });
                    self.skipWaiting();

                    return;
                }

                var etag_url = PRECACHE_URLS[i],
                    index = etag_url.indexOf('" '),
                    newEtag = etag_url.substring(0, index + 1),
                    url = etag_url.substring(index + 2);

                cache.match(url)
                    .then(function (request) {

                        if (request) {

                            var oldEtag = request.headers.get('ETag');

                            if (newEtag !== oldEtag) {

                                cache.delete(request)
                                    .then(function () {

                                        cache.add(url).then(function () {

                                            postMessage({ type: 'PRECACHE_NEW_CONTENT', url, version: VERSION });
                                            next();
                                        });
                                    });
                            }

                            else { next(); }
                        }

                        else {

                            cache.add(url).then(function () {

                                postMessage({ type: 'PRECACHE_NEW_CONTENT', url, version: VERSION });
                                next();
                            });
                        }
                    })
                    .catch(function () {

                        console.warn("Error precaching", url, err);
                        postMessage({ type: 'PRECACHE_ERROR', url, version: VERSION, error: err.message });
                    });
            }
        })
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', function (event) {

    event.waitUntil(
        caches.open(PRECACHE).then(function (cache) {

            cache.keys().then(function (requests) {

                var i = -1;
                next();

                function next() {

                    i++;

                    if (i >= requests.length) { return removeNonPrecacheCaches(); }

                    var pathname = new URL(requests[i].url).pathname,
                        etag_url = PRECACHE_URLS.find(function (etag_url) {

                            var url = etag_url.substring(etag_url.indexOf('" ') + 2);

                            return url === pathname;
                        });

                    if (!etag_url) {

                        cache.delete(requests[i]).then(next);
                    }

                    else { next(); }
                }
                function removeNonPrecacheCaches() {

                    caches.keys()
                        .then(function (cacheNames) {
                            return Promise.all(
                                cacheNames.map(function (cacheName) {

                                    if (cacheName !== PRECACHE) {

                                        caches.delete(cacheName);
                                    }
                                }));
                        })
                        .then(function () {

                            clients.claim();
                        });
                }
            });
        })
    );
});

// Fetch event: serve cached content when offline
self.addEventListener('fetch', event => {


    var url = new URL(event.request.url, self.location.origin);

    if (url.origin === self.location.origin) {

        if (url.pathname === '/') { url.pathname += 'index.html' }

        event.respondWith(caches.open(PRECACHE).
            then(function (precacheCache) {

                return precacheCache.match(url)
                    .then(function (response) {

                        if (response) { return response; }

                        return caches.open(RUNTIME)
                            .then(function (runtimeCache) {

                                return runtimeCache.match(url)
                                    .then(function (response) {

                                        if (navigator.onLine && (event.request.url.includes('?') || /[:]/.test(url.pathname))) {

                                            return fetch(new Request(url + '', { cache: 'no-cache' })).then(response => {

                                                if (response.status === 200 && response.redirected) {

                                                    return fetch(new Request(response.redirected + '', { cache: 'no-cache' })).then(response => {

                                                        return response;
                                                    });
                                                }
                                                return response;
                                            });
                                        }

                                        if (response && response.status === 200 && !response.redirected) {

                                            return response;
                                        }

                                        return get_content(runtimeCache, response, url)
                                            .then(function (response) {

                                                return response;
                                            });
                                });
                            });
                    });
            })
            .catch(function (err) {

                console.error("Service Worker fetching Error:", err);
            })
        );
    }
});

function get_content(cache, previousResponse, url) {

    var requestUrl = previousResponse?.redirected && previousResponse.url || (url + ''),
        etag = previousResponse?.headers ? previousResponse.headers.get('ETag') : null,
        headers = new Headers({});

    if (etag) { headers.set('If-None-Match', etag); }

    return fetch(new Request(requestUrl, { cache: 'no-cache', headers: headers }))
        .then(function (response) {

            if (response.status === 304) {

                return previousResponse || response;
            }

            if (response.status === 200 && response.redirected) {

                return get_content(cache, response, requestUrl);
            }

            if (response.status === 200 && !response.redirected) {

                if (response.headers.get("Cache-Control") === "no-cache") {

                    return response;
                }

                return cache.put(response.url, response)
                    .then(function () {

                        return response;
                    });
            }

            console.warn("Not found resource in", requestUrl);

            if (requestUrl === url) {

                return new Response(null, { status: 404, statusText: 'Not Found' });
            }

            return fetch(new Request(url)).then(function (response) {

                if (response.status !== 200 || response.redirected) { return response; }

                return cache.put(response.url, response)
                    .then(function () {

                        return resolve(response);
                    });

            })
        });
}

function postMessage(msg) {

    self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
        .then(function (clientList) {

            clientList.forEach(function (client) {

                client.postMessage(msg);
            });
        });
}