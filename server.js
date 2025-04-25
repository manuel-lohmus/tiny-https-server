/**  Copyright (c) Manuel Lõhmus (MIT License). */

'use strict';

var blacklistBlockingLimit = 100,
    maxAutoScalingConnections = 3,

    fs = require("node:fs"),
    path = require("node:path"),
    zlib = require('node:zlib'),
    { pipeline } = require('node:stream'),
    url = require('node:url'),
    http = require("node:http"),
    https = require("node:https"),
    configSets = require("config-sets"),
    dataContext = require('data-context'),

    hostnames = _getHostnames(),
    mimeTypes = require(path.join(__dirname, "mimeTypes.js")),
    events = {},
    requestArr = [_routerRequest, _node_modules_request, _static_request],
    routerRequestObj = {
        '*': {
            '/service_worker_version': _service_worker_version_request,
            '/service_worker': _service_worker_request,
            '/service_worker.js': _service_worker_request,
            '/.well-known/blacklist': _blacklist_info,
            '/.well-known/traffic-advice': _well_known_traffic_advice,
            '/.well-known/security.txt': _well_known_security_txt
        }
    },
    // Configurations
    serverOptions = configSets('tiny-https-server', {
        isDebug: false,
        host: '0.0.0.0',
        port: 80,
        exclusive: false,
        logDir: './log/tiny-https-server',
        directory_index: 'index.html',
        primary_domain: {
            document_root: './public/www',
            service_worker_version: '0',
            service_worker_version_update: true,
            is_new_service_worker_reload_browser: false,
            precache_urls: [],
            headers: { default: { server: "tiny-https-server" } },
            sitemap_update: true
        },
        subdomains: {},
        cache_control: {
            fileTypes: {
                webp: "max-age=2592000", //30 days
                bmp: "max-age=2592000", //30 days
                jpeg: "max-age=2592000", //30 days
                jpg: "max-age=2592000", //30 days
                png: "max-age=2592000", //30 days
                svg: "max-age=2592000", //30 days
                pdf: "max-age=2592000", //30 days
                woff2: "max-age=2592000", //30 days
                woff: "max-age=2592000", //30 days
                "image/svg+xml": "max-age=2592000", //30 days

                html: "max-age=86400", //1 days
                css: "max-age=86400", //1 days
                js: "max-age=86400", //1 days
            }
        },
        pathToBlacklistFile: './log/tiny-https-server/blacklist.json',
        bad_path_validation_regex_patterns: ['.php$|.asmx$'],
        contact_email: 'default@' + hostnames[0] //'default@localhost'
    }),
    blacklist = dataContext.watchJsonFile({ filePath: serverOptions.pathToBlacklistFile });

module.exports = { createHttpServer, createHttpsServer, availableLinks: _availableLinks };

return;


/**
 * @param {Options} options
 * @param {boolean} isHttpToHttps
 * @returns {http.Server}
 */
function createHttpServer(options = {}, isHttpToHttps = false) {

    if (configSets.isSaveChanges) {

        options = configSets.assign(serverOptions, options, true);
    }
    else {

        options = Object.assign(options, serverOptions);
    }

    var server = http.createServer(options);
    server.options = options;

    server.on("newListener", _newListener);
    server.addRequest = _addRequest.bind(server);
    server.availableLinks = _availableLinks.bind(server);

    server._emit = server.emit;
    server.emit = _emit;


    setTimeout(function () { _autoScaling.call(server); });

    setImmediate(function () {

        var host = options.host && options.host !== '0.0.0.0' ? options.host : hostnames[0];

        if (isHttpToHttps) {

            requestArr.unshift(_requestRedirectToHttps);

            server.listen({ port: 80, host: options.host }, function (err) {

                if (err) { return pError(err); }
                pDebug(`Server running at http://${host}/ redirect to https`);
            });
        }

        else {

            requestArr.unshift(_well_known_acme_challenge);

            server.listen(options, function (err) {

                if (err) { return pError(err); }
                pDebug(`Server running at http://${host}:${options.port}/`);
            });
        }
    });

    // watch node_modules
    trackNodeModules();

    // watch primary_document_root
    trackDirectoryServiceWorkerVersion(serverOptions.primary_domain);

    // watch subdomains
    Object.keys(serverOptions.subdomains).forEach(function (host) {
        trackDirectoryServiceWorkerVersion(serverOptions.subdomains[host]);
    });

    return server;
}

/**
 * @param {Options} options
 * @returns {https.Server}
 */
function createHttpsServer(options = {}) {

    if (configSets.isSaveChanges) {

        options = configSets.assign(serverOptions, options, true);
    }
    else {

        options = Object.assign(options, serverOptions);
    }

    if (!options.port || options.port === 80) { options.port = 443; }
    if (!options.pathToPrivkey) { options.pathToPrivkey = path.join(__dirname, "./cert/localhost-key.pem"); }
    if (!options.pathToCert) { options.pathToCert = path.join(__dirname, "./cert/localhost-cert.pem"); }

    if (!fs.existsSync(options.pathToPrivkey) || !fs.existsSync(options.pathToCert)) { throw `'pathToCert' or 'pathToPrivkey' is not available`; }

    var server = https.createServer(Object.assign({
        key: fs.readFileSync(options.pathToPrivkey),
        cert: fs.readFileSync(options.pathToCert)
    }, options));
    server.options = options;

    server.on("newListener", _newListener);
    server.addRequest = _addRequest.bind(server);
    server.availableLinks = _availableLinks.bind(server);

    server._emit = server.emit;
    server.emit = _emit;

    setTimeout(function () { _autoScaling.call(server); });

    setImmediate(function () {

        server.listen(options, listenCallback);
    });

    if (fs.existsSync(options.pathToPrivkey) && fs.existsSync(options.pathToCert)) {

        var certUpdateWaitTimeout;
        fs.watch(path.dirname(options.pathToCert), function (eventType, filename) {

            if (!fs.existsSync(options.pathToPrivkey) || !fs.existsSync(options.pathToCert)) { return; }

            clearTimeout(certUpdateWaitTimeout);
            certUpdateWaitTimeout = setTimeout(function () {

                server.setSecureContext({
                    key: fs.readFileSync(options.pathToPrivkey),
                    cert: fs.readFileSync(options.pathToCert)
                });
            }, 10000);
        });
    }

    return server;

    function listenCallback(err) {

        if (err) { return pError(err); }

        var host = options.host && options.host !== '0.0.0.0' ? options.host : hostnames[0];

        if (options.port === 443) { return pDebug(`Server running at https://${host}/`); }

        pDebug(`Server running at https://${host}:${options.port}/`);
    }
}

/**
 * Track the changes in 'node_modules' directory to update the Service Worker Version
 * @returns {void}
 */
function trackNodeModules() {

    if (configSets.enableFileReadWrite && fs.existsSync('./node_modules')) {

        var updateTimeout;
        fs.watch('./node_modules', function (eventType, filename) {

            if (!filename || filename.includes('/.')) { return; }

            clearTimeout(updateTimeout);
            updateTimeout = setTimeout(function () {

                // update service worker version
                updatedServiceWorkerVersion(serverOptions.primary_domain);

                // update subdomains service worker version
                Object.keys(serverOptions.subdomains).forEach(function (host) {

                    updatedServiceWorkerVersion(serverOptions.subdomains[host]);
                });
            }, 10000);
        });
    }

    function updatedServiceWorkerVersion(domainOptions) {

        if (domainOptions.service_worker_version_update) {

            domainOptions.service_worker_version = new Date().toISOString().split('.').shift();
        }
    }
}
/**
 * Track the changes in the directory to update the Service Worker Version
 * @param {DomainOptions} domainOptions
 * @returns {void}
 * 
 * @typedef {Object} DomainOptions
 * @property {string} document_root
 * @property {boolean} sitemap_update
 * @property {boolean} service_worker_version_update
 */
function trackDirectoryServiceWorkerVersion(domainOptions) {

    if (configSets.enableFileReadWrite && domainOptions && fs.existsSync(_resolvePath(domainOptions.document_root))) {

        var updateTimeout;
        fs.watch(_resolvePath(domainOptions.document_root), updatedServiceWorkerVersion);
    }

    function updatedServiceWorkerVersion(eventType, filename) {

        if (!filename ||
            filename.includes('/.') ||
            filename.endsWith('sitemap.xml') ||
            !fs.existsSync(_resolvePath(domainOptions.document_root))) {

            return;
        }

        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(function () {

            if (domainOptions.sitemap_update) {

                updateSitemapXml();
            }

            if (domainOptions.service_worker_version_update) {

                domainOptions.service_worker_version = new Date().toISOString().split('.').shift();
            }

        }, 10000);
    }
    function updateSitemapXml() {

        fs.writeFileSync(
            path.join(_resolvePath(domainOptions.document_root), 'sitemap.xml'),
            `<?xml version="1.0" encoding="utf-8" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>/</loc>
    <lastmod>${new Date().toISOString().split('.').shift() + '+00:00'}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`,
            { encoding: 'utf8', mode: 0o777 }
        );
    }
}
/**
 * Info: https://nodejs.org/docs/latest/api/events.html#event-newlistener
 * @param {string} eventName - The name of the event being listened for
 * @param {(event:string, listener:Function)=>void} fnListener - The event handler function
 */
function _newListener(eventName, fnListener) {

    if (eventName === "request") {

        requestArr.splice(requestArr.length - 2, 0, fnListener);
    }
}
/**
 * Add a listener for the request
 * @param {{host:''|string|'*', path:string}} options - The default value of host is an empty string '', that is Primary Host, the value '*' selects all Hosts
 * @param {(req:http.IncomingMessage, res:http.ServerResponse, next:()=>void)=>void} listener - The event handler function
 */
function _addRequest(options = { host: '', path: '/' }, listener) {

    options = Object.assign({
        host: '',
        path: '/'
    }, options);

    if (!routerRequestObj[options.host + '']) {

        routerRequestObj[options.host + ''] = {};
    }

    routerRequestObj[options.host + ''][options.path + ''] = listener;

    _addValidatedPath.call(this, options.host, options.path);

    return this;
}
/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {()=>void} next
 */
function _routerRequest(req, res, next) {

    var { host } = _get_host_settings(req.headers.host, this.options);
    var _url = match(routerRequestObj[host], req.url);

    if (_url) {

        if (_url.endsWith('/*')) {

            req.url = req.url.replace(_url.substring(0, _url.length - 2), '');
            if (req.url[0] !== '/') { req.url = '/' + req.url; } // add leading slash
        }

        return routerRequestObj[host][_url].call(this, req, res, next);
    }

    _url = match(routerRequestObj['*'], req.url);

    if (_url) { return routerRequestObj['*'][_url].call(this, req, res, next); }

    next();

    function match(o, u) {

        if (!o) { return; }

        return Object.keys(o)
            .sort(function (a, b) { return b.length - a.length; }) // sort by length
            .find(function (k) {
                return u.startsWith(
                    k.replace(/\/\*$/, '') // remove /* from the end
                );
            }); // find the longest match
    }
}
/**
 * redirect http to https
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns
 */
function _requestRedirectToHttps(req, res, next) {

    var server = this;

    if (server instanceof https.Server) { return next(); }

    // for log file
    res.on('close', function () { _log.call(server, req, res); });

    // for .well-known/acme-challenge/
    if (req.url.startsWith("/.well-known/acme-challenge") && _isValidatedPath.call(server, '*', req.url.substring(2))) {

        return _well_known_acme_challenge.call(server, req, res);
    }

    // for service worker version
    if (req.url.startsWith("/service_worker_version")) { return _service_worker_version_request.call(server, req, res); }

    // for service worker
    if (req.url.startsWith("/service_worker")) { return _service_worker_request.call(server, req, res); }

    // for blacklist info
    if (req.url.startsWith("/.well-known/blacklist")) { return _blacklist_info.call(server, req, res); }

    // for traffic advice 
    if (req.url.startsWith("/.well-known/traffic-advice")) { return _well_known_traffic_advice.call(server, req, res); }

    // for security.txt
    if (req.url.startsWith("/.well-known/security.txt")) { return _well_known_security_txt.call(server, req, res); }

    // for robots.txt
    if (req.url.startsWith("/robots.txt")) { return _static_request.call(server, req, res); }

    // for sitemap.xml
    if (req.url.startsWith("/sitemap.xml")) { return _static_request.call(server, req, res); }


    var ip = req.client.remoteAddress;

    // blocking
    if (blacklist[ip] && blacklist[ip].queries >= blacklistBlockingLimit) {

        blacklist[ip].status = "blocking";
        blacklist[ip].queries++;

        _blacklist_request(req, res);

        return;
    }

    if (!_isValidatedPath.call(server, '*', req.url)) {

        _bad_request.call(server, req, res);

        return;
    }

    // redirect http to https
    res.writeHead(302, { "Location": "https://" + req.headers["host"] + req.url });
    res.end(`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Refresh" content="0; URL=https://${req.headers["host"] + req.url}" />
    <script src="script.js">window.location = "https://${req.headers["host"] + req.url}";</script>
  </head>
  <body>
    <code>redirected => <a href="https://${req.headers["host"] + req.url}">https://${req.headers["host"] + req.url}</a></code>
  </body>
</html>
    `);

    return;
}
function _well_known_acme_challenge(req, res, next) {

    var server = this;

    // for .well-known/acme-challenge/
    if (req.url.startsWith("/.well-known/acme-challenge") && _isValidatedPath.call(server, '*', req.url.substring(2))) {

        var { host, document_root, service_worker_version, precache_urls } = _get_host_settings(req.headers.host, server.options);
        var filename = path.join(process.cwd(), document_root, req.url);

        if (fs.existsSync(filename)) {

            res.writeHead(200);
            res.end(fs.readFileSync(filename));

            return;
        }

        _not_found_content.call(server, req, res);

        return;
    }

    next?.();
}
function _well_known_traffic_advice(req, res) {

    if (this.isAutoExit || this.emittedAutoScaling) { return sendTrafficAdvice(true); }

    sendTrafficAdvice();

    function sendTrafficAdvice(isServerOccupied) {

        res.writeHead(200, {
            "Content-Type": "application/trafficadvice+json",
            "Cache-Control": "no-cache"
        });

        res.end(JSON.stringify(
            [{
                "user_agent": "prefetch-proxy",
                "fraction": isServerOccupied ? 0.2 : 0.8
            }]
        ));
    }
}
function _well_known_security_txt(req, res) {

    if (this.options?.contact_email && _validateEmail(this.options.contact_email)) {

        res.writeHead(200, {
            "Content-Type": "text/plain",
            "Cache-Control": "no-cache"
        });
        res.end(`
Contact: ${this.options.contact_email}
Preferred-Languages: en
        `);

        return;
    }

    _not_found_content.call(this, req, res);
}
/**
 * @param {Options} options
 * @returns {[string]}
 */
function _availableLinks(hostname) {

    var _links = [],
        _port = serverOptions?.port | null;

    (hostname ? [hostname] : hostnames)
        .forEach(function (_hostname) {

            if (_hostname === '*') { return; }

            Object.keys(routerRequestObj['*']).forEach(function (_path) {

                addPath(_hostname, _path);
            });

            if (routerRequestObj[_hostname]) {

                Object.keys(routerRequestObj[_hostname]).forEach(function (_path) {

                    addPath(_hostname, _path);
                });
            }

            var { document_root } = _get_host_settings(getHostname(_hostname), serverOptions);

            _getFiles(document_root).forEach(function (_path) {

                addPath(_hostname, _path.replace(document_root, ''));
            });

            _getFiles('./node_modules').forEach(function (_path) {

                if (_path.includes('/.')) { return; }

                addPath(_hostname, _path.replace('./', '/'));
            });
        });

    _links = _links.sort();

    return _links;

    function getHostname(_hostname) {

        return _hostname === '' ? hostname : _hostname.trim();
    }

    function addPath(_hostname, _path) {

        var _url = new url.URL('http://localhost');
        _url.hostname = getHostname(_hostname);
        _url.port = _port;
        _url.protocol = _port === 443 ? "https:" : "http:";
        _url.pathname = _path;
        _url = _url.toString().trim();

        if (_url && !_links.includes(_url)) { _links.push(_url); }
    }
}
function _emit(eventName, req, res) {

    var server = this;

    if (eventName === "request") {

        process.nextTick(function () {

            res.on('close', function () {

                if (req.iterator) {

                    req.iterator = undefined;
                    //delete req.iterator;
                }

                _log.call(server, req, res);
                req.destroy();
            });

            var host_settings = _get_host_settings(req.headers.host || '', server.options);

            if (server.options.port === 80 && req.url.startsWith("/.well-known/acme-challenge")
                && _isValidatedPath.call(server, host_settings.host, req.url.substring(2))) {

                // for .well-known/acme-challenge
                _static_request.call(server, req, res);

                return;
            }

            if (blacklist_check(req.client.remoteAddress, host_settings)) { return; }

            req.iterator = requestArr.entries();

            _setDefHeader.call(server, req, res);

            next();

            function next() {

                res.fnRequest = req.iterator.next().value[1];

                if (typeof res.fnRequest === "function") {

                    res.fnRequest.call(server, req, res, next);
                }
            }
        });

        return;
    }

    else if (events[eventName] && events[eventName].length) {

        (function (name, ...args) {

            for (var i = 0; i < events[eventName].length; i++) {

                events[eventName][i].call(server, ...args);

                if (events[eventName][i].once) {

                    events[eventName].splice(i, 1);
                    i--;
                }
            }

        })(...arguments);
    }

    server._emit.apply(server, arguments);

    return;


    function blacklist_check(ip, host_settings) {

        // blocking
        if (blacklist[ip]
            && blacklist[ip].queries > blacklistBlockingLimit) {

            blacklist[ip].queries++;
            blacklist[ip].last_request = last_request(req, res);
            blacklist[ip].last_interval = last_interval(blacklist[ip].last_date || blacklist[ip].start_date);
            blacklist[ip].last_date = new Date().toJSON();

            _blacklist_request(req, res);

            return true;
        }

        // bad request
        if (!ip || !_isValidatedPath.call(server, host_settings.host, req.url)) {

            if (!blacklist[ip]) {

                blacklist[ip] = {
                    status: "watching",
                    start_date: new Date().toJSON(),
                    queries: 1,
                    last_request: last_request(req, res)
                };
            }
            else {

                blacklist[ip].queries++;
                blacklist[ip].status = "watching";
                blacklist[ip].last_request = last_request(req, res);
                blacklist[ip].last_interval = last_interval(blacklist[ip].last_date || blacklist[ip].start_date);
                blacklist[ip].last_date = new Date().toJSON();
            }

            _bad_request.call(server.options, req, res);

            return true;
        }

        // remove from blacklist if the last interval is more than 1 day
        if (blacklist[ip]?.status === "watching" && blacklist[ip]?.last_interval?.includes("days")) {

            blacklist[ip] = null;
        }
    }
    function last_request(req, res) {

        return req.headers.host
            + (req.socket.localPort ? ":" + req.socket.localPort : "") + " "
            + req.method + " "
            + req.url;
    }
    function last_interval(last_date) {

        var result = "";
        var diff = new Date().getTime() - new Date(last_date).getTime();

        var days = Math.floor(diff / (1000 * 60 * 60 * 24));
        diff -= days * (1000 * 60 * 60 * 24);
        if (days > 0) { result += days + " days : "; }

        var hours = Math.floor(diff / (1000 * 60 * 60));
        diff -= hours * (1000 * 60 * 60);
        if (hours > 0) { result += hours + " hours : "; }

        var mins = Math.floor(diff / (1000 * 60));
        diff -= mins * (1000 * 60);
        if (mins > 0) { result += mins + " minutes : "; }

        var seconds = diff / 1000;
        result += seconds + " seconds";

        return result;
    }
}
function _autoScaling() {

    var server = this;

    var interval = setInterval(function () {

        server.getConnections(function (err, count) {

            if (err) { pError(err); }
            
            if (count) {

                clearTimeout(scalingDown.timeout);

                if (count > maxAutoScalingConnections && !server.emittedAutoScaling) {

                    server.emittedAutoScaling = true;
                    server._emit("autoscaling", count);
                }
            }
            else {

                server.emittedAutoScaling = false;
                if (server.isAutoExit) { scalingDown.call(server); }
            }
        });
    }, 10000);

    function scalingDown() {

        var server = this;

        scalingDown.timeout = setTimeout(function () {

            server.getConnections(function (err, count) {

                if (err) { pError(err); }

                if (count) { return; }

                clearInterval(interval);

                server.close(function (err) {

                    if (err) { pError(err); }

                    setTimeout(function () { process.exit(err ? 1 : 0); }, 10);
                });
            });

        }, 30000);
    }
}
function _log(req, res) {

    if (!this.options.logDir) { return; }

    if (!_log.logFileName) { _setupLogFile.call(this); }

    var ip = req.client.remoteAddress || 'unknown';
    var port = req.client.remotePort || 'unknown';
    var msg = blacklist[ip] ? blacklist[ip].status : "";
    while (msg.length < 9) { msg += ' '; }
    // client address and port
    msg += ip + ":" + port + " "; //255.255.255.255:65535
    while (msg.length < 31) { msg += ' '; }
    msg += "[" + new Date().toISOString() + "] ";
    // host
    msg += (req.headers.host || 'unknown') + " ";
    while (msg.length < 80) { msg += ' '; }
    // status code or connection refused
    msg += res.writableFinished ? res.statusCode + " " : "--- ";
    msg += req.method + " ";
    while (msg.length < 92) { msg += ' '; }
    msg += req.url + " ";
    while (msg.length < 150) { msg += ' '; }
    // user agent
    msg += '"' + (req.headers["user-agent"] || 'unknown') + '"\r\n';
    _log.content += msg;


    function _setupLogFile() {

        var date = new Date(),
            night = Date.UTC(
                date.getUTCFullYear(),
                date.getUTCMonth(),
                date.getUTCDate(),
                0, 0, 0, 0
            ) + (24 * 60 * 60 * 1000);

        _log.logFileName = path.join(process.cwd(), this.options.logDir, date.toISOString().split('T').shift() + '.log');

        if (!fs.existsSync(path.dirname(_log.logFileName))) {
            fs.mkdirSync(path.dirname(_log.logFileName), { recursive: true });
        }

        setTimeout(function () { _log.logFileName = ''; }, night - Date.now());

        _log.inrerval = setInterval(function () {

            if (!_log.logFileName) {

                clearInterval(_log.inrerval);
                return;
            }
            if (_log.logFileName && _log.content.length) {

                fs.appendFile(
                    _log.logFileName,
                    _log.content,
                    { flag: 'a+' },
                    function (err) {
                        if (err) { pError(err); }
                    }
                );
                _log.content = '';
            }
        }, 10000);
    }
}
function _setDefHeader(req, res) {

    var { host } = _get_host_settings(req.headers.host, this.options);

    if (host === "") {

        _setHeader(this.options?.primary_domain?.headers?.["default"]);
        _setHeader(this.options?.primary_domain?.headers?.[res.req.url]);
    }
    else if (this.options.subdomains[host]) {

        _setHeader(this.options?.subdomains?.[host]?.headers?.["default"]);
        _setHeader(this.options?.subdomains?.[host]?.headers?.[res.req.url]);
    }

    function _setHeader(objHeaders) {

        if (objHeaders) {

            for (var key of Object.keys(objHeaders)) {

                res.setHeader(key, objHeaders[key]);
            }
        }
    }
}
function _service_worker_version_request(req, res) {

    if (req.method.toLocaleUpperCase() === "GET") {

        var { host, service_worker_version } = _get_host_settings(req.headers.host, this.options, false);

        //*** Service Worker Version ***
        if ((!host || this.options.subdomains[host])
            && req.method.toLocaleUpperCase() === "GET") {

            return response(service_worker_version);
        }
    }

    return _not_found_content.call(this, req, res);


    function response(ws_version) {

        res.writeHead(200, { "Content-Type": "text/plain; charset=UTF-8" });
        res.end(ws_version);
    }
}
function _service_worker_request(req, res) {

    if (req.method.toLocaleUpperCase() === "GET") {

        var isServerSSL = (this.options.port === 80)
            ? false
            : Boolean(
                this.options.key && this.options.cert
                || this.options.port === 443
            );
        var isClientSSL = Boolean(req.client.ssl);
        var redirectToHttps = isServerSSL && !isClientSSL;

        if (redirectToHttps) {

            return response(`
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.keys().then(cachesToDelete => {
			return Promise.all(cachesToDelete.map(cacheToDelete => {
				return caches.delete(cacheToDelete);
			}));
		})
			.then(self.skipWaiting())
	);
});self.addEventListener('activate', event => {
	self.clients.claim();
});
            `);
        }

        var settings = _get_host_settings(req.headers.host, this.options, false);

        //*** Service Worker Strict ***
        if ((!settings.host || this.options.subdomains[settings.host])) {

            return response(_getServiceWorkerCode(settings), settings);
        }
    }

    return _not_found_content.call(this, req, res);


    function response(code, settings) {

        var headers = {
            "Content-Type": "text/javascript; charset=UTF-8"
        }

        if (settings) { headers["ETag"] = '"' + code.length + "-" + settings.service_worker_version + '"'; }

        res.writeHead(200, headers);
        res.end(code);
    }
}
/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {()=>void} next
 */
function _node_modules_request(req, res, next) {

    if (req.url.startsWith("/node_modules") && req.method.toLocaleUpperCase() === "GET") {

        var server = this,
            modulePaths = req.url.split('?').shift().split("/").filter(function (v) { return v; }),
            [moduleName, moduleVersion] = modulePaths[1].split("@"),
            packagePath = path.join(process.cwd(), "node_modules", moduleName, "package.json"),
            packageInfo = null;

        modulePaths[1] = moduleName;

        if (fs.existsSync(packagePath)) { packageInfo = require(packagePath); }
        if (modulePaths.length === 2 && packageInfo) { modulePaths.push(packageInfo.browser || packageInfo.main); }

        if (moduleVersion && packageInfo?.version && !packageInfo.version.startsWith(moduleVersion)) {

            _not_found_content.call(server, req, res);

            return;
        }

        _static_file.call(server, path.join(process.cwd(), ...modulePaths), res, function () {

            // /node_modules/tiny-https-server/
            if (moduleName === "tiny-https-server" && modulePaths.length === 2) {

                _static_file.call(server, path.join(process.cwd(), "browser.js"), res, function () {

                    _not_found_content.call(server, req, res);
                });

                return;
            }

            _not_found_content.call(server, req, res);
        });

        return;
    }

    next();
}
/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function _static_request(req, res) {

    var server = this;
    var { host, document_root, service_worker_version, precache_urls } = _get_host_settings(req.headers.host, server.options);

    //*** Static File ***
    if (document_root && (req.method.toLocaleUpperCase() === "GET" || req.method.toLocaleUpperCase() === "HEAD")) {

        var filename = req.url.split("?").shift();

        if (!filename.length || filename.endsWith("/")) { filename += server.options.directory_index; }
        if (filename.startsWith("/")) { filename = filename.substring(1); }

        filename = path.join(process.cwd(), document_root, filename);

        _static_file.call(server, filename, res, function () {

            _not_found_content.call(server, req, res);
        }, host);

        return;
    }

    _not_found_content.call(server, req, res, 3000);
}
/**
 * @param {string} host
 * @returns {{host:string,document_root:string}}
 */
function _get_host_settings(host, options, cached = true) {

    host = host?.trim() || "";
    host = host.replace(/:\d+$/, ""); // remove port number

    if (cached && _get_host_settings.host_settings?.[host]) { return _get_host_settings.host_settings[host]; }

    var _host = host,
        document_root = "",
        service_worker_version = "0",
        is_new_service_worker_reload_browser = false,
        precache_urls = null;

    if (host?.toLocaleLowerCase().startsWith("www.")) { host = host.substring(4); }

    // Excellent Default Domain
    if (host === options.host) {
        host = "";
    }
    // Excellent
    else if (options.subdomains[host]) {
        //host = host;
    }
    else {
        var objHost = _parseHost(host);

        // Virtual Domain
        if (options.subdomains[objHost.domain]) {
            host = objHost.domain;
        }
        // Subdomain
        else if (options.subdomains[objHost.hostname]) {
            host = objHost.hostname;
        }
        // Subdomain
        else if (options.subdomains[objHost.subdomains[objHost.subdomains.length - 1]]) {
            host = objHost.subdomains[objHost.subdomains.length - 1];
        }
        else if (objHost.subdomains.length) {
            host = objHost.subdomains.join(".");
        }
        else if (hostnames.includes(objHost.domain)) {
            host = "";
        }
        // Not found domain
        else {
            host = "";
        }
    }

    if (host === "") {

        document_root = options.primary_domain.document_root;
        service_worker_version = options.primary_domain.service_worker_version;
        is_new_service_worker_reload_browser = options.primary_domain.is_new_service_worker_reload_browser;
        precache_urls = options.primary_domain.precache_urls;
    }

    else if (options.subdomains[host]) {

        document_root = options.subdomains[host].document_root;

        if (options.subdomains[host].service_worker_version === undefined) {

            options.subdomains[host].service_worker_version = service_worker_version;
            //this.emit("options_changed", options);
        }
        service_worker_version = options.subdomains[host].service_worker_version;

        if (options.subdomains[host].is_new_service_worker_reload_browser === undefined) {

            options.subdomains[host].is_new_service_worker_reload_browser = is_new_service_worker_reload_browser;
            //this.emit("options_changed", options);
        }
        is_new_service_worker_reload_browser = options.subdomains[host].is_new_service_worker_reload_browser;

        if (options.subdomains[host].precache_urls === undefined) {

            options.subdomains[host].precache_urls = precache_urls;
            //this.emit("options_changed", options);
        }
        precache_urls = options.subdomains[host].precache_urls;
    }

    if (!_get_host_settings.host_settings) { _get_host_settings.host_settings = {}; }

    _get_host_settings.host_settings[_host] = {
        host,
        document_root,
        service_worker_version,
        is_new_service_worker_reload_browser,
        precache_urls
    };

    return _get_host_settings.host_settings[_host];
}
/**
 * @param {string} filename
 * @param {http.ServerResponse} res
 * @param {()void} callback
 */
function _static_file(filename, res, fn_not_found, subdomain) {

    var server = this;

    fs.stat(filename, function (err, stats) {

        if (stats) {

            if (!stats.size) {

                return _static_file.call(server, filename + '/' + server.options.directory_index, res, fn_not_found, subdomain);
            }

            var url = res.req.url;
            var statusCode = 200;
            var acceptEncoding = res.req.headers['accept-encoding'] || "";
            var cache_control = server.options.cache_control.fileTypes[path.extname(filename).substring(1)];
            var raw = fs.createReadStream(filename);
            var headers = res.headers || {};


            if (acceptEncoding) { headers["Vary"] = "Accept-Encoding"; }
            if (mimeTypes[path.extname(filename)]) { headers["Content-Type"] = mimeTypes[path.extname(filename)]; }
            if (cache_control && statusCode === 200) { headers["Cache-Control"] = cache_control; }
            else if (statusCode === 200) { headers["Cache-Control"] = "no-cache"; }

            headers["Content-Length"] = stats.size;
            headers["Last-Modified"] = stats.mtime.toUTCString();
            headers["ETag"] = '"' + stats.size + "-" + Date.parse(stats.mtime) + '"';

            if (res.req.method.toLocaleUpperCase() === "HEAD") {

                res.writeHead(statusCode, headers);
                res.end();
            }
            else if (stats.size > 128 && /\bgzip\b/.test(acceptEncoding)) {

                headers["Content-Encoding"] = "gzip";
                res.writeHead(statusCode, headers);
                pipeline(raw, zlib.createGzip(), res, onError);
            }
            else if (stats.size > 128 && /\bdeflate\b/.test(acceptEncoding)) {

                headers["Content-Encoding"] = "deflate";
                res.writeHead(statusCode, headers);
                pipeline(raw, zlib.createDeflate(), res, onError);
            }
            else if (stats.size > 128 && /\bbr\b/.test(acceptEncoding)) {

                headers["Content-Encoding"] = "br";
                res.writeHead(statusCode, headers);
                pipeline(raw, zlib.createBrotliCompress(), res, onError);
            }
            else {

                headers["Content-Length"] = stats.size;
                res.writeHead(statusCode, headers);
                pipeline(raw, res, onError);
            }
        }
        else if (typeof fn_not_found === "function") { fn_not_found(); }
    });

    return;


    function onError(err) {

        if (err) {
            // If an error occurs, there's not much we can do because
            // the server has already sent the 200 response code and
            // some amount of data has already been sent to the client.
            // The best we can do is terminate the response immediately
            // and log the error.
            pError(err);
            res.end();
        }
    }
}
/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function _not_found_content(req, res, set_timeout) {

    pDebug('404 Not Found', {
        url: req.url,
        ip: req.socket.remoteAddress,
        userAgent: req.headers["user-agent"]
    });

    if (this.options.isDebug) {

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.write("404 Not Found Url: " + req.url + "\n");
        res.write("Headers: " + JSON.stringify(req.headers, null, 2) + "\n");
    }
    else {
        res.writeHead(404);
    }

    if (0 < set_timeout) {
        setTimeout(function () { res.end(); }, set_timeout);
    }
    else { res.end(); }
}
/**
 * Parse url host
 * @param {string} host
 * @returns{{
 *  port:string|null,
 *  tld:string|null,
 *  domain:string|null,
 *  subdomains:[],
 *  hostname:string,
 *  host:string
 * }}
 */
function _parseHost(host) {

    // List of Internet top-level domains
    var tld = ["aaa", "aarp", "abarth", "abb", "abbott", "abbvie", "abc", "able", "abogado", "abudhabi", "ac", "academy", "accenture", "accountant", "accountants", "aco", "actor", "ad", "adac", "ads", "adult", "ae", "aeg", "aero", "aetna", "af", "afl", "africa", "ag", "agakhan", "agency", "ai", "aig", "airbus", "airforce", "airtel", "akdn", "al", "alfaromeo", "alibaba", "alipay", "allfinanz", "allstate", "ally", "alsace", "alstom", "am", "amazon", "americanexpress", "americanfamily", "amex", "amfam", "amica", "amsterdam", "analytics", "android", "anquan", "anz", "ao", "aol", "apartments", "app", "apple", "aq", "aquarelle", "ar", "arab", "aramco", "archi", "army", "arpa", "art", "arte", "as", "asda", "asia", "associates", "at", "athleta", "attorney", "au", "auction", "audi", "audible", "audio", "auspost", "author", "auto", "autos", "avianca", "aw", "aws", "ax", "axa", "az", "azure", "ba", "baby", "baidu", "banamex", "bananarepublic", "band", "bank", "bar", "barcelona", "barclaycard", "barclays", "barefoot", "bargains", "baseball", "basketball", "bauhaus", "bayern", "bb", "bbc", "bbt", "bbva", "bcg", "bcn", "bd", "be", "beats", "beauty", "beer", "bentley", "berlin", "best", "bestbuy", "bet", "bf", "bg", "bh", "bharti", "bi", "bible", "bid", "bike", "bing", "bingo", "bio", "biz", "bj", "black", "blackfriday", "blockbuster", "blog", "bloomberg", "blue", "bm", "bms", "bmw", "bn", "bnpparibas", "bo", "boats", "boehringer", "bofa", "bom", "bond", "boo", "book", "booking", "bosch", "bostik", "boston", "bot", "boutique", "box", "br", "bradesco", "bridgestone", "broadway", "broker", "brother", "brussels", "bs", "bt", "bugatti", "build", "builders", "business", "buy", "buzz", "bv", "bw", "by", "bz", "bzh", "ca", "cab", "cafe", "cal", "call", "calvinklein", "cam", "camera", "camp", "cancerresearch", "canon", "capetown", "capital", "capitalone", "car", "caravan", "cards", "care", "career", "careers", "cars", "casa", "case", "cash", "casino", "cat", "catering", "catholic", "cba", "cbn", "cbre", "cbs", "cc", "cd", "center", "ceo", "cern", "cf", "cfa", "cfd", "cg", "ch", "chanel", "channel", "charity", "chase", "chat", "cheap", "chintai", "christmas", "chrome", "church", "ci", "cipriani", "circle", "cisco", "citadel", "citi", "citic", "city", "cityeats", "ck", "cl", "claims", "cleaning", "click", "clinic", "clinique", "clothing", "cloud", "club", "clubmed", "cm", "cn", "co", "coach", "codes", "coffee", "college", "cologne", "com", "comcast", "commbank", "community", "company", "compare", "computer", "comsec", "condos", "construction", "consulting", "contact", "contractors", "cooking", "cookingchannel", "cool", "coop", "corsica", "country", "coupon", "coupons", "courses", "cpa", "cr", "credit", "creditcard", "creditunion", "cricket", "crown", "crs", "cruise", "cruises", "cu", "cuisinella", "cv", "cw", "cx", "cy", "cymru", "cyou", "cz", "dabur", "dad", "dance", "data", "date", "dating", "datsun", "day", "dclk", "dds", "de", "deal", "dealer", "deals", "degree", "delivery", "dell", "deloitte", "delta", "democrat", "dental", "dentist", "desi", "design", "dev", "dhl", "diamonds", "diet", "digital", "direct", "directory", "discount", "discover", "dish", "diy", "dj", "dk", "dm", "dnp", "do", "docs", "doctor", "dog", "domains", "dot", "download", "drive", "dtv", "dubai", "dunlop", "dupont", "durban", "dvag", "dvr", "dz", "earth", "eat", "ec", "eco", "edeka", "edu", "education", "ee", "eg", "email", "emerck", "energy", "engineer", "engineering", "enterprises", "epson", "equipment", "er", "ericsson", "erni", "es", "esq", "estate", "et", "etisalat", "eu", "eurovision", "eus", "events", "exchange", "expert", "exposed", "express", "extraspace", "fage", "fail", "fairwinds", "faith", "family", "fan", "fans", "farm", "farmers", "fashion", "fast", "fedex", "feedback", "ferrari", "ferrero", "fi", "fiat", "fidelity", "fido", "film", "final", "finance", "financial", "fire", "firestone", "firmdale", "fish", "fishing", "fit", "fitness", "fj", "fk", "flickr", "flights", "flir", "florist", "flowers", "fly", "fm", "fo", "foo", "food", "foodnetwork", "football", "ford", "forex", "forsale", "forum", "foundation", "fox", "fr", "free", "fresenius", "frl", "frogans", "frontdoor", "frontier", "ftr", "fujitsu", "fun", "fund", "furniture", "futbol", "fyi", "ga", "gal", "gallery", "gallo", "gallup", "game", "games", "gap", "garden", "gay", "gb", "gbiz", "gd", "gdn", "ge", "gea", "gent", "genting", "george", "gf", "gg", "ggee", "gh", "gi", "gift", "gifts", "gives", "giving", "gl", "glass", "gle", "global", "globo", "gm", "gmail", "gmbh", "gmo", "gmx", "gn", "godaddy", "gold", "goldpoint", "golf", "goo", "goodyear", "goog", "google", "gop", "got", "gov", "gp", "gq", "gr", "grainger", "graphics", "gratis", "green", "gripe", "grocery", "group", "gs", "gt", "gu", "guardian", "gucci", "guge", "guide", "guitars", "guru", "gw", "gy", "hair", "hamburg", "hangout", "haus", "hbo", "hdfc", "hdfcbank", "health", "healthcare", "help", "helsinki", "here", "hermes", "hgtv", "hiphop", "hisamitsu", "hitachi", "hiv", "hk", "hkt", "hm", "hn", "hockey", "holdings", "holiday", "homedepot", "homegoods", "homes", "homesense", "honda", "horse", "hospital", "host", "hosting", "hot", "hoteles", "hotels", "hotmail", "house", "how", "hr", "hsbc", "ht", "hu", "hughes", "hyatt", "hyundai", "ibm", "icbc", "ice", "icu", "id", "ie", "ieee", "ifm", "ikano", "il", "im", "imamat", "imdb", "immo", "immobilien", "in", "inc", "industries", "infiniti", "info", "ing", "ink", "institute", "insurance", "insure", "int", "international", "intuit", "investments", "io", "ipiranga", "iq", "ir", "irish", "is", "ismaili", "ist", "istanbul", "it", "itau", "itv", "jaguar", "java", "jcb", "je", "jeep", "jetzt", "jewelry", "jio", "jll", "jm", "jmp", "jnj", "jo", "jobs", "joburg", "jot", "joy", "jp", "jpmorgan", "jprs", "juegos", "juniper", "kaufen", "kddi", "ke", "kerryhotels", "kerrylogistics", "kerryproperties", "kfh", "kg", "kh", "ki", "kia", "kids", "kim", "kinder", "kindle", "kitchen", "kiwi", "km", "kn", "koeln", "komatsu", "kosher", "kp", "kpmg", "kpn", "kr", "krd", "kred", "kuokgroup", "kw", "ky", "kyoto", "kz", "la", "lacaixa", "lamborghini", "lamer", "lancaster", "lancia", "land", "landrover", "lanxess", "lasalle", "lat", "latino", "latrobe", "law", "lawyer", "lb", "lc", "lds", "lease", "leclerc", "lefrak", "legal", "lego", "lexus", "lgbt", "li", "lidl", "life", "lifeinsurance", "lifestyle", "lighting", "like", "lilly", "limited", "limo", "lincoln", "linde", "link", "lipsy", "live", "living", "lk", "llc", "llp", "loan", "loans", "locker", "locus", "loft", "lol", "london", "lotte", "lotto", "love", "lpl", "lplfinancial", "lr", "ls", "lt", "ltd", "ltda", "lu", "lundbeck", "luxe", "luxury", "lv", "ly", "ma", "macys", "madrid", "maif", "maison", "makeup", "man", "management", "mango", "map", "market", "marketing", "markets", "marriott", "marshalls", "maserati", "mattel", "mba", "mc", "mckinsey", "md", "me", "med", "media", "meet", "melbourne", "meme", "memorial", "men", "menu", "merckmsd", "mg", "mh", "miami", "microsoft", "mil", "mini", "mint", "mit", "mitsubishi", "mk", "ml", "mlb", "mls", "mm", "mma", "mn", "mo", "mobi", "mobile", "moda", "moe", "moi", "mom", "monash", "money", "monster", "mormon", "mortgage", "moscow", "moto", "motorcycles", "mov", "movie", "mp", "mq", "mr", "ms", "msd", "mt", "mtn", "mtr", "mu", "museum", "music", "mutual", "mv", "mw", "mx", "my", "mz", "na", "nab", "nagoya", "name", "natura", "navy", "nba", "nc", "ne", "nec", "net", "netbank", "netflix", "network", "neustar", "new", "news", "next", "nextdirect", "nexus", "nf", "nfl", "ng", "ngo", "nhk", "ni", "nico", "nike", "nikon", "ninja", "nissan", "nissay", "nl", "no", "nokia", "northwesternmutual", "norton", "now", "nowruz", "nowtv", "np", "nr", "nra", "nrw", "ntt", "nu", "nyc", "nz", "obi", "observer", "office", "okinawa", "olayan", "olayangroup", "oldnavy", "ollo", "om", "omega", "one", "ong", "onl", "online", "ooo", "open", "oracle", "orange", "org", "organic", "origins", "osaka", "otsuka", "ott", "ovh", "pa", "page", "panasonic", "paris", "pars", "partners", "parts", "party", "passagens", "pay", "pccw", "pe", "pet", "pf", "pfizer", "pg", "ph", "pharmacy", "phd", "philips", "phone", "photo", "photography", "photos", "physio", "pics", "pictet", "pictures", "pid", "pin", "ping", "pink", "pioneer", "pizza", "pk", "pl", "place", "play", "playstation", "plumbing", "plus", "pm", "pn", "pnc", "pohl", "poker", "politie", "porn", "post", "pr", "pramerica", "praxi", "press", "prime", "pro", "prod", "productions", "prof", "progressive", "promo", "properties", "property", "protection", "pru", "prudential", "ps", "pt", "pub", "pw", "pwc", "py", "qa", "qpon", "quebec", "quest", "racing", "radio", "re", "read", "realestate", "realtor", "realty", "recipes", "red", "redstone", "redumbrella", "rehab", "reise", "reisen", "reit", "reliance", "ren", "rent", "rentals", "repair", "report", "republican", "rest", "restaurant", "review", "reviews", "rexroth", "rich", "richardli", "ricoh", "ril", "rio", "rip", "ro", "rocher", "rocks", "rodeo", "rogers", "room", "rs", "rsvp", "ru", "rugby", "ruhr", "run", "rw", "rwe", "ryukyu", "sa", "saarland", "safe", "safety", "sakura", "sale", "salon", "samsclub", "samsung", "sandvik", "sandvikcoromant", "sanofi", "sap", "sarl", "sas", "save", "saxo", "sb", "sbi", "sbs", "sc", "sca", "scb", "schaeffler", "schmidt", "scholarships", "school", "schule", "schwarz", "science", "scot", "sd", "se", "search", "seat", "secure", "security", "seek", "select", "sener", "services", "ses", "seven", "sew", "sex", "sexy", "sfr", "sg", "sh", "shangrila", "sharp", "shaw", "shell", "shia", "shiksha", "shoes", "shop", "shopping", "shouji", "show", "showtime", "si", "silk", "sina", "singles", "site", "sj", "sk", "ski", "skin", "sky", "skype", "sl", "sling", "sm", "smart", "smile", "sn", "sncf", "so", "soccer", "social", "softbank", "software", "sohu", "solar", "solutions", "song", "sony", "soy", "spa", "space", "sport", "spot", "sr", "srl", "ss", "st", "stada", "staples", "star", "statebank", "statefarm", "stc", "stcgroup", "stockholm", "storage", "store", "stream", "studio", "study", "style", "su", "sucks", "supplies", "supply", "support", "surf", "surgery", "suzuki", "sv", "swatch", "swiss", "sx", "sy", "sydney", "systems", "sz", "tab", "taipei", "talk", "taobao", "target", "tatamotors", "tatar", "tattoo", "tax", "taxi", "tc", "tci", "td", "tdk", "team", "tech", "technology", "tel", "temasek", "tennis", "teva", "tf", "tg", "th", "thd", "theater", "theatre", "tiaa", "tickets", "tienda", "tiffany", "tips", "tires", "tirol", "tj", "tjmaxx", "tjx", "tk", "tkmaxx", "tl", "tm", "tmall", "tn", "to", "today", "tokyo", "tools", "top", "toray", "toshiba", "total", "tours", "town", "toyota", "toys", "tr", "trade", "trading", "training", "travel", "travelchannel", "travelers", "travelersinsurance", "trust", "trv", "tt", "tube", "tui", "tunes", "tushu", "tv", "tvs", "tw", "tz", "ua", "ubank", "ubs", "ug", "uk", "unicom", "university", "uno", "uol", "ups", "us", "uy", "uz", "va", "vacations", "vana", "vanguard", "vc", "ve", "vegas", "ventures", "verisign", "versicherung", "vet", "vg", "vi", "viajes", "video", "vig", "viking", "villas", "vin", "vip", "virgin", "visa", "vision", "viva", "vivo", "vlaanderen", "vn", "vodka", "volkswagen", "volvo", "vote", "voting", "voto", "voyage", "vu", "vuelos", "wales", "walmart", "walter", "wang", "wanggou", "watch", "watches", "weather", "weatherchannel", "webcam", "weber", "website", "wed", "wedding", "weibo", "weir", "wf", "whoswho", "wien", "wiki", "williamhill", "win", "windows", "wine", "winners", "wme", "wolterskluwer", "woodside", "work", "works", "world", "wow", "ws", "wtc", "wtf", "xbox", "xerox", "xfinity", "xihuan", "xin", "xn--11b4c3d", "xn--1ck2e1b", "xn--1qqw23a", "xn--2scrj9c", "xn--30rr7y", "xn--3bst00m", "xn--3ds443g", "xn--3e0b707e", "xn--3hcrj9c", "xn--3pxu8k", "xn--42c2d9a", "xn--45br5cyl", "xn--45brj9c", "xn--45q11c", "xn--4dbrk0ce", "xn--4gbrim", "xn--54b7fta0cc", "xn--55qw42g", "xn--55qx5d", "xn--5su34j936bgsg", "xn--5tzm5g", "xn--6frz82g", "xn--6qq986b3xl", "xn--80adxhks", "xn--80ao21a", "xn--80aqecdr1a", "xn--80asehdb", "xn--80aswg", "xn--8y0a063a", "xn--90a3ac", "xn--90ae", "xn--90ais", "xn--9dbq2a", "xn--9et52u", "xn--9krt00a", "xn--b4w605ferd", "xn--bck1b9a5dre4c", "xn--c1avg", "xn--c2br7g", "xn--cck2b3b", "xn--cckwcxetd", "xn--cg4bki", "xn--clchc0ea0b2g2a9gcd", "xn--czr694b", "xn--czrs0t", "xn--czru2d", "xn--d1acj3b", "xn--d1alf", "xn--e1a4c", "xn--eckvdtc9d", "xn--efvy88h", "xn--fct429k", "xn--fhbei", "xn--fiq228c5hs", "xn--fiq64b", "xn--fiqs8s", "xn--fiqz9s", "xn--fjq720a", "xn--flw351e", "xn--fpcrj9c3d", "xn--fzc2c9e2c", "xn--fzys8d69uvgm", "xn--g2xx48c", "xn--gckr3f0f", "xn--gecrj9c", "xn--gk3at1e", "xn--h2breg3eve", "xn--h2brj9c", "xn--h2brj9c8c", "xn--hxt814e", "xn--i1b6b1a6a2e", "xn--imr513n", "xn--io0a7i", "xn--j1aef", "xn--j1amh", "xn--j6w193g", "xn--jlq480n2rg", "xn--jlq61u9w7b", "xn--jvr189m", "xn--kcrx77d1x4a", "xn--kprw13d", "xn--kpry57d", "xn--kput3i", "xn--l1acc", "xn--lgbbat1ad8j", "xn--mgb9awbf", "xn--mgba3a3ejt", "xn--mgba3a4f16a", "xn--mgba7c0bbn0a", "xn--mgbaakc7dvf", "xn--mgbaam7a8h", "xn--mgbab2bd", "xn--mgbah1a3hjkrd", "xn--mgbai9azgqp6j", "xn--mgbayh7gpa", "xn--mgbbh1a", "xn--mgbbh1a71e", "xn--mgbc0a9azcg", "xn--mgbca7dzdo", "xn--mgbcpq6gpa1a", "xn--mgberp4a5d4ar", "xn--mgbgu82a", "xn--mgbi4ecexp", "xn--mgbpl2fh", "xn--mgbt3dhd", "xn--mgbtx2b", "xn--mgbx4cd0ab", "xn--mix891f", "xn--mk1bu44c", "xn--mxtq1m", "xn--ngbc5azd", "xn--ngbe9e0a", "xn--ngbrx", "xn--node", "xn--nqv7f", "xn--nqv7fs00ema", "xn--nyqy26a", "xn--o3cw4h", "xn--ogbpf8fl", "xn--otu796d", "xn--p1acf", "xn--p1ai", "xn--pgbs0dh", "xn--pssy2u", "xn--q7ce6a", "xn--q9jyb4c", "xn--qcka1pmc", "xn--qxa6a", "xn--qxam", "xn--rhqv96g", "xn--rovu88b", "xn--rvc1e0am3e", "xn--s9brj9c", "xn--ses554g", "xn--t60b56a", "xn--tckwe", "xn--tiq49xqyj", "xn--unup4y", "xn--vermgensberater-ctb", "xn--vermgensberatung-pwb", "xn--vhquv", "xn--vuq861b", "xn--w4r85el8fhu5dnra", "xn--w4rs40l", "xn--wgbh1c", "xn--wgbl6a", "xn--xhq521b", "xn--xkc2al3hye2a", "xn--xkc2dl3a5ee0h", "xn--y9a3aq", "xn--yfro4i67o", "xn--ygbi2ammx", "xn--zfr164b", "xxx", "xyz", "yachts", "yahoo", "yamaxun", "yandex", "ye", "yodobashi", "yoga", "yokohama", "you", "youtube", "yt", "yun", "za", "zappos", "zara", "zero", "zip", "zm", "zone", "zuerich", "zw"];
    tld.push("local");
    var _host = {
        port: null,
        tld: null,
        domain: null,
        subdomains: []
    };

    host = host ? (host + "") : "";

    // get port
    host = host.split(":");
    _host.port = host.length > 1 ? host.pop() : null;
    host = host.join(":");

    var ip = _isValidIP(host);
    if (ip) {
        _host.domain = ip;
        return _host;
    }

    host = host.split(".");

    // get tld
    _host.tld = tld.includes(host[host.length - 1]) ? host.pop() : null;

    // get domain
    _host.domain = host.length > 0 ? host.pop() : null;
    if (_host.tld) { _host.domain += "." + _host.tld; }

    // get subdomains
    _host.subdomains = host.length > 0 ? host : [];

    Object.defineProperty(_host, "hostname", {
        get: function () {
            var arr = Array.from(_host.subdomains);
            if (_host.domain) { arr.push(_host.domain); }
            return arr.join(".");
        },
        set: function (val) { _host = _parseHost(val); }
    });

    Object.defineProperty(_host, "host", {
        get: function () {
            var result = _host.hostname;
            if (_host.port) { result += ":" + _host.port; }
            return result;
        },
        set: function (val) { _host = _parseHost(val); }
    });

    return _host;
}
/**
 * Check if string is IP address (IPv4) "192.168.5.68" or "192-168-5-68"
 * Returns string "192.168.5.68" or null
 * @param {string} str
 * @returns {string|null}
 */
function _isValidIP(str) {

    str = (str + "").trim().replace(/-/g, ".");
    // Regular expression to check if string is a IP address
    const regexExp = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;

    if (regexExp.test(str))
        return str;

    return null;
}
function _validateEmail(strEmail) {

    var [localPart, domain] = (strEmail + '').split('@');

    if (localPart && domain) {

        domain = _parseHost(domain);

        if (domain.tld) { return true; }
    }

    return false;
}
function _isValidatedPath(host, strPath) {

    if (this.validatePaths?.[host]?.[strPath] || this.validatePaths?.['*']?.[strPath]) { return true; }

    var decodePath;
    try { decodePath = decodeURI((strPath + '').split('?').shift()); } catch (err) { return false; }
    if (decodePath.indexOf('\0') !== -1) { return false; }
    if (decodePath.indexOf('..') !== -1) { return false; }

    decodePath = decodePath.replace('/.well-known', '');
    if (decodePath.indexOf('/.') !== -1) { return false; }

    //regex patterns
    for (var i = 0; i < this.options.bad_path_validation_regex_patterns.length; i++) {

        if (decodePath.search(new RegExp(this.options.bad_path_validation_regex_patterns[i])) > -1) {

            return false;
        }
    }

    _addValidatedPath.call(this, host, strPath);

    return true;
}
function _addValidatedPath(host, strPath) {

    if (!this.validatePaths) { this.validatePaths = {}; }
    if (!this.validatePaths[host]) { this.validatePaths[host] = {}; }
    this.validatePaths[host][strPath] = true;
}
function _bad_request(req, res) {

    res.writeHead(400);

    setTimeout(function () {
        res.end();
    }, 3000);
}
function _blacklist_request(req, res) {

    function wait() {

        res.writeProcessing();

        res.timeout = setTimeout(function () {

            if (count > 20) {

                res.writeHead(408, { Connection: "close" });
                res.end();
                return;
            }

            count++;
            wait();

        }, 3000);
    }
    var count = 0;

    res.on('close', function () {
        clearTimeout(res.timeout);
    });
    res.timeout = setTimeout(function () { wait(); }, 3000);
}
function _sortBlacklist(blacklist, search) {

    var entries = Array.from(Object.entries(blacklist));

    if (search) {

        search = search.toString().toLowerCase();
        search = search.replace(/[^a-z0-9\.\-]/g, ''); // remove special characters

        entries = entries.filter(function (v) {

            if ((v[0] + '').toLowerCase().includes(search)) { return true; }

            if (!v[1]) { return false; }

            return Object.keys(v[1]).some(function (key) {

                return v[1][key].toString().toLowerCase().includes(search);
            });
        });
    }

    entries.sort(function (a, b) {

        a = a[1]?.start_date ? a[1].start_date + "" : "";
        b = b[1]?.start_date ? b[1].start_date + "" : "";

        return a.localeCompare(b);
    });

    entries.reverse();

    return Object.fromEntries(entries);
}
function _blacklist_info(req, res) {

    var search = req.url.split("?")[1] || "";

    res.writeHead(200, {
        "Content-Type": "text/json",
        "Cache-Control": "no-cache"
    });
    res.write(JSON.stringify(_sortBlacklist(blacklist, search), null, 2));
    res.end();
}
function _getHostnames() {

    var os = require('node:os'),
        hostname = os.hostname().toLowerCase();

    return [hostname, hostname + ".local", "localhost", "127.0.0.1"]
        .concat(
            Object.values(os.networkInterfaces())
                .flat()
                .filter(function (item) { return !item.internal && item.family === "IPv4"; })
                .map(function (item) { return item.address; })
        )
        .filter(function (item, pos, arr) { return arr.indexOf(item) === pos; });
}
function _resolvePath(pathToFile) {

    pathToFile = path.resolve(path.parse(process.argv[1]).dir.split("node_modules").shift(), pathToFile);

    return pathToFile;
}
//*** Service Worker ***
function _getServiceWorkerCode(settings) {
    return `
var RUNTIME = 'runtime@${settings.service_worker_version}';
var PRECACHE = 'precache@${settings.service_worker_version}';
var PRECACHE_URLS = ${_getCachingFilesToString(settings.precache_urls, settings.document_root)};

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(PRECACHE)
			.then(function (cache) {
				PRECACHE_URLS.forEach(function (url) {
					return get_content(cache, url, null, true);
				});
			})${settings.is_new_service_worker_reload_browser ? '.then(self.skipWaiting())' : ''}
	);
});
self.addEventListener('activate', event => {
	var currentCaches = [PRECACHE, RUNTIME];
	event.waitUntil(
		caches.keys().then(cacheNames => {
			return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
		}).then(cachesToDelete => {
			return Promise.all(cachesToDelete.map(cacheToDelete => {
				return caches.delete(cacheToDelete);
			}));
		}).then(() => self.clients.claim())
	);
});
self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url, self.location.origin);
    if (url.origin === self.location.origin) {
        if (url.pathname === '/') { url.pathname += 'index.html' }
        event.respondWith((async () => {
            var precacheCache = await caches.open(PRECACHE);
            var precacheResponse = await precacheCache.match(url);
            if (precacheResponse) return precacheResponse;
            var runtimeCache = await caches.open(RUNTIME);
            var runtimeCacheResponse = await runtimeCache.match(url);
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
            if (runtimeCacheResponse && runtimeCacheResponse.status === 200 && !runtimeCacheResponse.redirected) {
                return runtimeCacheResponse;
            }
            return get_content(runtimeCache, url + '', runtimeCacheResponse?.redirected && runtimeCacheResponse.url);
        })());
    }
});
function get_content(cache, url, redirectUrl, isPRECACHE) {

	var _url = redirectUrl || url;

	return fetch(new Request(_url, { cache: 'no-cache' })).then(response => {
		if (response.status === 200 && response.redirected) {
			return get_content(cache, url, response.url);
		}
		else if (response.status === 200 && !response.redirected) {
			if (!isPRECACHE && response.headers.get("Cache-Control") === "no-cache") {
				return response;
			}
			return cache.put(url, response.clone()).then(() => {
				return response;
			});
		}
		else {
			console.warn("Not found resource in", _url);
			return fetch(new Request(url, { cache: 'no-cache' })).then(response => {
				if (response.status !== 200 || response.redirected) { return response; }
				return cache.put(url, response.clone()).then(() => {
					return response;
				});
			});
		}
	});
}
    `;
}
function _getCachingFilesToString(precache_urls, document_root) {

    if (precache_urls === null) { return '[]'; }

    if (!Array.isArray(precache_urls)) { precache_urls = []; }

    precache_urls = precache_urls.concat(_getFiles(document_root));

    return `[${precache_urls
        .map(function (fsPath) {
            return '\r\n\t"'
                + fsPath.replace(document_root, '')
                + '"';
        })
        .join(',')}
]`;
}
function _getFiles(fsPath) {

    if (!fs.lstatSync(fsPath).isDirectory()) { return [fsPath]; }

    return fs.readdirSync(fsPath).reduce(function (filesPath, name) {
        if (name.startsWith('.')) { return filesPath; }
        //if (options.pathToError_404.includes(name)) { return filesPath; }
        return filesPath.concat(_getFiles(`${fsPath}/${name}`));
    }, []);

}

// Debugging
function pDebug(msg) { if (serverOptions.isDebug) { console.log(`[ DEBUG ] 'tiny-https-server' `, ...arguments); } }
function pError(msg) { if (serverOptions.isDebug) { console.error(`[ ERROR ] 'tiny-https-server' `, ...arguments); } }