/** Web server functions. @preserve Copyright (c) 2021 Manuel Lõhmus. */
"use strict";

var hostname = require('os').hostname().toLowerCase();
var hostnames = [hostname, hostname + ".local", "localhost", "127.0.0.1", "::1"];
var configSets = require('config-sets');
var options = configSets.init({
    tiny_https_server: {
        domain: hostname,
        port: 80,
        logDir: "./log/tiny-https-server",
        document_root: "./public/www",
        directory_index: "index.html",
        pathToError_404: "./error_404.html",
        pathToPrivkey: "",
        pathToCert: "",
        subdomains: {},
        cacheControl: {},
        setHeaders: {
            default: {},
            //"/": { "X-Frame-Options": "DENY" }
        },
        service_worker_version: "0.0.0",
        content_delivery_network_url: " ", //"https://cdn.jsdelivr.net/npm/",
        content_delivery_network_root: " ",
        precache_urls: null,
        blacklist: {},
        blacklist_blocking_from: 100
    }
}).tiny_https_server;

if (!options.cacheControl.fileTypes) {

    options.cacheControl.fileTypes = {
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
    };
    configSets.save();
}


var fs = require("fs");
var path = require("path");
var zlib = require('zlib');
var { pipeline } = require('stream');

var url = require('node:url');
var http = require("http");
var https = require("https");
var isSSL = options.port === 80 ? false : options.pathToPrivkey !== "" && options.pathToCert !== "";
var mimeTypes = require(path.join(__dirname, "mimeTypes.js"));
var logDir = path.join(process.cwd(), options.logDir);
var blacklist = Object.assign({}, options.blacklist);

if (!fs.existsSync(logDir)) { fs.mkdirSync(logDir, { recursive: true }); }

if (!isSSL && options.domain === "localhost" && (!options.port || options.port === 443)) {
    options.pathToPrivkey = path.join(__dirname, "./cert/localhost-key.pem");
    options.pathToCert = path.join(__dirname, "./cert/localhost-cert.pem");
    isSSL = true;
}

if (isSSL) {

    if (!options.port) { options.port = 443; }
    try {
        http.createServer(function (req, res) {

            res.on('close', function () { log(req, res); });

            var ip = req.client.remoteAddress;

            if (req.url.startsWith("/.well-known/acme-challenge/") && isValidatePath(req.url.substring(2))) {
                // for .well-known/acme-challenge/
                static_request(req, res);
            }
            else if (blacklist[ip]
                && blacklist[ip].queries >= options.blacklist_blocking_from) {
                blacklist[ip].status = "blocking";
                blacklist[ip].queries++;
                blacklist_request(req, res);
                return;
            }
            else {
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
    redirect http to https
  </body>
</html>
            `);
            }
        }).listen(80);
    }
    catch (err) { console.error(err); }
}

var server = isSSL
    ? https.createServer({ key: fs.readFileSync(options.pathToPrivkey), cert: fs.readFileSync(options.pathToCert) })
    : http.createServer();

var requestArr = [node_modules_request, static_request];
server.on("newListener", function (event, listener) {

    if (event === "request") {
        requestArr.splice(requestArr.length - 2, 0, listener);
    }
});
var emit = server.emit;
server.emit = function (eventName, req, res) {


    if (eventName === "request") {

        setImmediate(function () {

            res.on('close', function () {

                if (req.iterator) {
                    req.iterator = undefined;
                    //delete req.iterator;
                }

                log(req, res);
            });

            var ip = req.client.remoteAddress;

            if (blacklist[ip]
                && blacklist[ip].queries > options.blacklist_blocking_from) {
                blacklist[ip].queries++;
                blacklist[ip].last_request = last_request(req, res);
                blacklist[ip].last_interval = last_interval(blacklist[ip].last_date || blacklist[ip].start_date);
                blacklist[ip].last_date = new Date().toJSON();
                if (blacklist[ip].queries.toString().endsWith("0")) {
                    saveBlacklist();
                }
                if (blacklist[ip].status !== "blocking") {
                    blacklist[ip].status = "blocking";
                    saveBlacklist();
                }
                blacklist_request(req, res);
                return;
            }
            if (!ip || !isValidatePath(req.url)) {
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
                bad_request(req, res);
                return;
            }

            req.iterator = requestArr.entries();

            function next() {

                res.fnRequest = req.iterator.next().value[1];

                if (typeof res.fnRequest === "function") {

                    res.fnRequest(req, res, next);
                }
            }

            next();
        });
    }
    else
        emit.apply(server, arguments);
};
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

server.listen(options.port, function (err) {

    if (err)
        console.error("[ ERROR ] 'tiny_https_server' " + err);
    else if (configSets.isDebug)
        console.log("[ DEBUG ] 'tiny_https_server' Webserver port:" + options.port + " pid:" + process.pid);
});

//server.on("request", function (req, res, next) { next(); });

server.on("request", function (req, res, next) {

    if (req.url === "/blacklist" || req.url === "/$blacklist") {
        res.writeHead(200, {
            "Content-Type": "text/json",
            "Cache-Control": "no-cache"
        });
        res.write(JSON.stringify(sortBlacklist(blacklist), null, 2));
        res.end();
        return;
    }
    next();
});

function log(req, res, prefix) {

    var ip = req.client.remoteAddress;
    var port = req.client.remotePort;
    var date = new Date();
    var year = date.getUTCFullYear();
    var month = date.getUTCMonth() + 1 < 10 ? `0${date.getUTCMonth() + 1}` : date.getUTCMonth() + 1;
    var day = date.getUTCDate() < 10 ? `0${date.getUTCDate()}` : date.getUTCDate();
    var fileName = path.join(process.cwd(), options.logDir, year + "-" + month + "-" + day + ".log");
    var msg = prefix ? prefix + " " : "";
    msg = blacklist[ip] ? blacklist[ip].status + " " : "";
    // client address and port
    msg += ip + ":" + port + " ";
    // universal time
    var hours = date.getUTCHours().toString(),
        minutes = date.getUTCMinutes().toString(),
        seconds = date.getUTCSeconds().toString(),
        milliseconds = date.getUTCMilliseconds().toString();
    if (hours.length < 2) { hours = "0" + hours; }
    if (minutes.length < 2) { minutes = "0" + minutes; }
    if (seconds.length < 2) { seconds = "0" + seconds; }
    while (milliseconds.length < 3) { milliseconds = "0" + milliseconds; }
    msg += "[" + hours + ":" + minutes + ":" + seconds + "." + milliseconds + "] ";
    // status code or connection refused
    msg += res.writableFinished ? res.statusCode + " " : "--- ";
    // host:port method url httpVersion
    msg += req.headers.host + (req.socket.localPort ? ":" + req.socket.localPort : "") + " " + req.method + " " + req.url + " HTTP/" + req.httpVersion + ' ';
    // user agent
    msg += '"' + req.headers["user-agent"] + '"\r\n';

    fs.appendFile(
        fileName,
        msg,
        { flag: 'a+' },
        function (err) { if (err) { console.error("[ ERROR ] 'tiny_https_server' " + err); } }
    );
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function node_modules_request(req, res, next) {

    if (req.url.startsWith("/node_modules") && req.method.toLocaleUpperCase() === "GET") {

        var filename = req.url.split("?").shift().split("/")
            .filter(function (v) { return v; })
            .map(function (v) { return v.split("@").shift(); })
            .join("/");

        fs.readFile(path.join(process.cwd(), filename, "package.json"), function (err, data) {

            if (!err) {
                try {
                    var pk = JSON.parse(data);
                    filename = path.join(process.cwd(), filename, pk.browser || pk.main);
                }
                catch (e) { err = e; }
            }

            if (filename.endsWith("node_modules/tiny-https-server")) { filename = "browser.js" }
            if (err) { filename = path.join(process.cwd(), filename); }

            static_file(filename, res, function () {

                filename = path.join(process.cwd(), options.document_root, options.pathToError_404);
                static_file(filename, res, function (exists) {

                    if (!exists) {

                        not_found_content(req, res);
                    }
                })
            });
        });
    }
    else
        next();
}
/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function static_request(req, res) {

    var { host, document_root, service_worker_version, content_delivery_network_url, content_delivery_network_root, precache_urls } = get_host_settings(req.headers.host);

    //*** Service Worker Version ***
    if (req.url === '/$service_worker_version' && (!host || options.subdomains[host])) {

        res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
        configSets.reload();
        res.end(service_worker_version);

        return;
    }
    //*** Service Worker Strict ***
    if (req.url === '/service_worker.js' && (!host || options.subdomains[host])) {

        res.writeHead(200, { "Content-Type": "text/javascript; charset=UTF-8" });
        res.end(getServiceWorkerCode({ host, document_root, service_worker_version, content_delivery_network_url, content_delivery_network_root, precache_urls }));

        return;
    }
    //*** Static File ***
    if (document_root && (req.method.toLocaleUpperCase() === "GET" || req.method.toLocaleUpperCase() === "HEAD")) {

        var filename = req.url.split("?").shift();

        if (!filename.length || filename.endsWith("/")) { filename += options.directory_index; }
        if (filename.startsWith("/")) { filename = filename.substring(1); }

        filename = path.join(process.cwd(), document_root, filename);

        static_file(filename, res, function () {

            filename = path.join(process.cwd(), options.document_root, options.pathToError_404);
            static_file(filename, res, function (exists) {

                if (!exists) {

                    not_found_content(req, res);
                }
            })
        }, host);

        return;
    }

    not_found_content(req, res, 3000);
}
/**
 * @param {string} host
 * @returns {{host:string,document_root:string}}
 */
function get_host_settings(host) {

    function _hostnames() {
        return hostnames.concat(Object.values(require("os").networkInterfaces())
            .flat()
            .filter(function (item) { return !item.internal && item.family === "IPv4"; })
            .map(function (item) { return item.address; })
        )
            .filter(function (item, pos, arr) { return arr.indexOf(item) === pos; });
    }

    var document_root = "",
        service_worker_version = "0.0.0",
        content_delivery_network_url = "",
        content_delivery_network_root = "",
        precache_urls = null;

    // Excellent Default Domain
    if (host === options.domain) {
        host = "";
    }
    // Excellent
    else if (options.subdomains[host]) {
        //host = host;
    }
    else {
        var objHost = parseHost(host);

        // Virtual Domain
        if (options.subdomains[objHost.domain]) {
            host = objHost.domain;
        }
        // Subdomain
        else if (options.subdomains[objHost.subdomains[objHost.subdomains.length - 1]]) {
            host = objHost.subdomains[objHost.subdomains.length - 1];
        }
        else if (_hostnames().includes(objHost.hostname)) {
            host = "";
        }
        // Not found domain
        else {
            host = 1;
        }
    }

    if (options.subdomains[host]) {
        document_root = options.subdomains[host].document_root;

        if (!options.subdomains[host].service_worker_version) {
            options.subdomains[host].service_worker_version = service_worker_version;
            configSets.save();
        }
        service_worker_version = options.subdomains[host].service_worker_version;

        if (!options.subdomains[host].content_delivery_network_url) {
            options.subdomains[host].content_delivery_network_url = content_delivery_network_url;
            configSets.save();
        }
        content_delivery_network_url = options.subdomains[host].content_delivery_network_url;

        if (!options.subdomains[host].content_delivery_network_root) {
            options.subdomains[host].content_delivery_network_root = content_delivery_network_root;
            configSets.save();
        }
        content_delivery_network_root = options.subdomains[host].content_delivery_network_root;

        if (!options.subdomains[host].precache_urls) {
            options.subdomains[host].precache_urls = precache_urls;
            configSets.save();
        }
        precache_urls = options.subdomains[host].precache_urls;
    }
    else if (host === "") {
        document_root = options.document_root;
        service_worker_version = options.service_worker_version;
        content_delivery_network_url = options.content_delivery_network_url;
        content_delivery_network_root = options.content_delivery_network_root;
        precache_urls = options.precache_urls;
    }

    if (content_delivery_network_url && !content_delivery_network_url.endsWith("/")) { content_delivery_network_url += "/"; }
    if (content_delivery_network_root && content_delivery_network_root.endsWith("/")) { content_delivery_network_root = content_delivery_network_root.slice(0, -1); }

    return { host, document_root, service_worker_version, content_delivery_network_url, content_delivery_network_root, precache_urls };
}
/**
 * @param {string} filename
 * @param {http.ServerResponse} res
 * @param {()void} callback
 */
function static_file(filename, res, fn_not_found, subdomain) {

    function onError(err) {
        if (err) {
            // If an error occurs, there's not much we can do because
            // the server has already sent the 200 response code and
            // some amount of data has already been sent to the client.
            // The best we can do is terminate the response immediately
            // and log the error.
            res.end();
            if (configSets.isDebug) console.error("[ ERROR ] 'tiny_https_server' An error occurred:", err);
        }
    }

    fs.stat(filename, function (err, stats) {

        if (stats) {

            var url = res.req.url;
            var statusCode = filename.endsWith(path.parse(options.pathToError_404).base) ? 404 : 200;
            var acceptEncoding = res.req.headers['accept-encoding'] || "";
            var cacheControl = options.cacheControl.fileTypes[path.extname(filename).substring(1)];
            var raw = fs.createReadStream(filename);
            var headers = res.headers || {};

            if (options.subdomains[subdomain]) {
                if (options.subdomains[subdomain].setHeaders) {

                    headers = Object.assign(headers, options.subdomains[subdomain].setHeaders["default"]);
                    headers = Object.assign(headers, options.subdomains[subdomain].setHeaders[url]);
                }
            }
            else if (subdomain === "") {
                headers = Object.assign(headers, options.setHeaders["default"]);
                headers = Object.assign(headers, options.setHeaders[url]);
            }

            if (acceptEncoding) { headers["Vary"] = "Accept-Encoding"; }
            if (mimeTypes[path.extname(filename)]) { headers["Content-Type"] = mimeTypes[path.extname(filename)]; }
            if (cacheControl && statusCode === 200) { headers["Cache-Control"] = cacheControl; }
            else if (statusCode === 200) { headers["Cache-Control"] = "no-cache"; }

            if (res.req.method.toLocaleUpperCase() === "HEAD") {

                headers["Content-Length"] = stats.size;
                res.writeHead(statusCode, headers);
                res.end();
            }
            else if (/\bgzip\b/.test(acceptEncoding)) {

                headers["Content-Encoding"] = "gzip";
                res.writeHead(statusCode, headers);
                pipeline(raw, zlib.createGzip(), res, onError);
            }
            else if (/\bdeflate\b/.test(acceptEncoding)) {

                headers["Content-Encoding"] = "deflate";
                res.writeHead(statusCode, headers);
                pipeline(raw, zlib.createDeflate(), res, onError);
            }
            else if (/\bbr\b/.test(acceptEncoding)) {

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
}
/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function not_found_content(req, res, set_timeout) {

    if (configSets.isDebug) {
        console.warn("[ WARN ] 'tiny_https_server' 404 Not Found", {
            url: req.url,
            ip: req.socket.remoteAddress,
            userAgent: req.headers["user-agent"]
        });

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.write("404 Not Found Url: " + req.url + "\n");
        res.write("Headers: " + JSON.stringify(req.headers, null, 2) + "\n");
    }
    else {
        res.writeHead(404);
    }

    if (set_timeout) {
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
function parseHost(host) {

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

    var ip = isValidIP(host);
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
            if (_host.tld) { arr.push(_host.tld); }
            return arr.join(".");
        },
        set: function (val) { _host = parseHost(val); }
    });

    Object.defineProperty(_host, "host", {
        get: function () {
            var result = _host.hostname;
            if (_host.port) { result += ":" + _host.port; }
            return result;
        },
        set: function (val) { _host = parseHost(val); }
    });

    return _host;
}
/**
 * Check if string is IP address (IPv4) "192.168.5.68" or "192-168-5-68"
 * Returns string "192.168.5.68" or null
 * @param {string} str
 * @returns {string|null}
 */
function isValidIP(str) {

    str = (str + "").trim().replace(/-/g, ".");
    // Regular expression to check if string is a IP address
    const regexExp = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;

    if (regexExp.test(str))
        return str;

    return null;
}

function isValidatePath(strPath) {

    try { strPath = decodeURI(strPath); } catch (err) { return false; }
    if (strPath.indexOf('\0') !== -1) { return false; }
    if (strPath.indexOf('..') !== -1) { return false; }
    if (strPath.indexOf('/.') !== -1) { return false; }
    if (strPath.indexOf('.php') !== -1) { return false; }
    if (strPath.indexOf('.asmx') !== -1) { return false; }
    //if (strPath === '/') { return '\\'; }
    //strPath = path.normalize(strPath);
    //strPath = strPath.replace(/^(\.\.(\/|\\|$))+/, '');
    //return strPath;
    return true;
}

function bad_request(req, res) {

    res.writeHead(400, { "Content-Type": "text/plain" });
    res.write("400 Bad Request\n");

    setTimeout(function () {
        res.end();
    }, 3000);
}

function blacklist_request(req, res) {

    function wait() {

        res.writeProcessing();

        res.timeout = setTimeout(function () {

            if (count > 20) {

                res.writeHead(408);
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

function sortBlacklist(blacklist, blockedOnly) {

    var entries = Array.from(Object.entries(blacklist));
    if (blockedOnly) { entries = entries.filter(function (v) { return v[1].status === "blocking"; }); }
    entries.sort(function (a, b) {

        if (a[1].last_date === undefined && b[1].last_date) {
            return 1;
        } else if (a[1].last_date && b[1].last_date === undefined) {
            return -1;
        } else if (a[1].last_date < b[1].last_date) {
            return 1;
        } else if (a[1].last_date > b[1].last_date) {
            return -1;
        } else if (a[1].start_date === undefined && b[1].start_date) {
            return 1;
        } else if (a[1].start_date && b[1].start_date === undefined) {
            return -1;
        } else if (a[1].start_date < b[1].start_date) {
            return 1;
        } else if (a[1].start_date > b[1].start_date) {
            return -1;
        } else {
            return 0;
        }
    });

    return Object.fromEntries(entries);
}

function saveBlacklist() {

    options.blacklist = sortBlacklist(blacklist, true);

    configSets.save();
}

module.exports = server;
server.options = options;
server.static_file = static_file;
server.not_found_content = not_found_content;
server.parseHost = parseHost;
server.isSSL = isSSL;
server.isValidatePath = isValidatePath;


//*** Service Worker ***
function getServiceWorkerCode(settings) {
    return `'use strict';

var RUNTIME = 'runtime@${settings.service_worker_version}';
var PRECACHE = '${settings.host || "localhost"}@${settings.service_worker_version}';
var PRECACHE_URLS = ${getCachingFilesToString(settings.precache_urls || settings.document_root)};

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(PRECACHE)
			.then(function (cache) {
				PRECACHE_URLS.forEach(function (url) {
					return get_CDN(cache, url);
				});
			})
			.then(self.skipWaiting())
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
    var url = event.request.url.split("#").shift();
	if (url.startsWith(self.location.origin)) {
		event.respondWith(
			caches.match(url).then(cachedResponse => {
				if (url.includes("/$")) {
					return fetch(new Request(url, { cache: 'no-cache' }));
				}
				if (cachedResponse && cachedResponse.status === 200 && !cachedResponse.redirected) {
					return cachedResponse;
				}
				return caches.open(RUNTIME).then(cache => {
					return get_CDN(cache, url, cachedResponse?.redirected && cachedResponse.url);
				});
			})
		);
	}
});
function get_CDN(cache, url, redirectUrl) {

	var CDN_url = redirectUrl || get_CDN_url(url);

	return fetch(new Request(CDN_url, { cache: 'no-cache' })).then(response => {
		if (response.status === 200 && response.redirected) {
			return get_CDN(cache, url, response.url);
		}
		else if (response.status === 200 && !response.redirected) {
            if (response.headers.get("Cache-Control") === "no-cache") {
                return response;
            }
			return cache.put(url, response.clone()).then(() => {
				return response;
			});
		}
		else {
			console.warn("Not found resource in", CDN_url);
			return fetch(new Request(url, { cache: 'no-cache' })).then(response => {
				if (response.status !== 200 || response.redirected) { return response; }
				return cache.put(url, response.clone()).then(() => {
					return response;
				});
			});
		}
	});
}
function get_CDN_url(url) {
	url = (url + "").split("#").shift().split("?").shift();
	if (url.endsWith("/")${url.parse(settings.content_delivery_network_url).hostname === 'cdn.jsdelivr.net' ? ' || url.endsWith("html")' : ''
        }) { return url; }
    if ("${settings.content_delivery_network_url}") {
        if (url.startsWith("http")) { url = (new URL(url)).pathname; }
		if (url.includes("/node_modules/")) {
			url = "${settings.content_delivery_network_url}" + url.split("/node_modules/").pop();
		}
        else if ("${settings.content_delivery_network_root}") {
            url = "${settings.content_delivery_network_url}" + "${settings.content_delivery_network_root}" + url;
        }
    }
	return url;
}`;
}
function getCachingFilesToString(document_root) {

    if (Array.isArray(document_root)) {
        return `[${document_root
            .map(function (fsPath) {
                return '\r\n\t"'
                    + fsPath
                    + '"';
            })
            .join(',')}
]`;
    }

    /** @param {string} fsPath @returns {[string]} */
    function _getFiles(fsPath) {

        if (!fs.lstatSync(fsPath).isDirectory()) { return [fsPath]; }

        return fs.readdirSync(fsPath).reduce(function (filesPath, name) {
            if (name.startsWith('.')) { return filesPath; }
            if (options.pathToError_404.includes(name)) { return filesPath; }
            return filesPath.concat(_getFiles(`${fsPath}/${name}`));
        }, []);

    }

    return `[${_getFiles(document_root)
        .map(function (fsPath) {
            return '\r\n\t"'
                + fsPath.replace(document_root, '')
                + '"';
        })
        .join(',')}
]`;
}