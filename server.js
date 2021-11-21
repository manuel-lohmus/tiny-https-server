/** Web server functions. @preserve Copyright (c) 2021 Manuel L�hmus. */
"use strict";

var options = require("config-sets").init({
    tiny_https_server: {
        domain: "localhost",
        port: "",
        logDir: "./log/tiny-https-server",
        document_root: "./public/www",
        directory_index: "index.html",
        pathToError_404: "./error_404.html",
        pathToPrivkey: "",
        pathToCert: "",
        subdomains: {}
    }
}).tiny_https_server;

var http = require("http");
var https = require("https");
var isSSL = options.pathToPrivkey !== "" && options.pathToCert !== "";
var port = options.port || (isSSL ? 443 : 80);
var path = require("path");
var fs = require("fs");
var mimeTypes = require(path.resolve(__dirname, "mimeTypes.js"));
var logDir = path.resolve(__dirname, options.logDir);

if (!fs.existsSync(logDir)) { fs.mkdirSync(logDir, { recursive: true }); }

if (isSSL && port === 443) {

    http.createServer(function (req, res) {
        if (req.url.startsWith("/."))
            // for .well-known/acme-challenge/
            static_reqest(req, res)
        else {
            // redirect http to https
            res.writeHead(302, { "Location": "https://" + req.headers["host"] + req.url }); 
            res.end();
        }
    }).listen(80);
}

var server = isSSL && port !== 80
    ? https.createServer({
        key: fs.readFileSync(options.pathToPrivkey),
        cert: fs.readFileSync(options.pathToCert)
    })
    : http.createServer();

function log(res) {

    var date = new Date();
    var fileName = path.resolve(__dirname, options.logDir, date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + ".log")
    var msg = res.req.client.remoteAddress + " ";
    msg += "[" + date.toLocaleString() + "] ";
    msg += '"' + res.req.headers.host + " " + res.req.method + " " + res.req.url + " HTTP/" + res.req.httpVersion + '" ';
    msg += res.statusCode + " ";
    msg += res.req.client.remotePort + " ";
    msg += '"' + res.req.headers["user-agent"] + '"\r\n';

    fs.appendFile(
        fileName,
        msg,
        { flag: 'a+' },
        function (err) { if (err) { console.error(err); } }
    );
}

var emit = server.emit;
server.emit = function () {

    var args = arguments;

    if (args[0] === "request") {

        args[2].on('finish', function () { log(this); });

        var requestArr = [];

        if (server._events.request) {
            if (typeof server._events.request === "function")
                requestArr.push(server._events.request);
            else
                requestArr = requestArr.concat(server._events.request);
        }

        requestArr.push(static_reqest);

        function next() {

            if (requestArr.length) {

                var fnRequest = requestArr.shift();
                fnRequest(args[1], args[2], next);
            }
        }

        next();
    }
    else
        emit.apply(server, args);
};

//server.on("request", function (req, res, next) { next(); });
//server.on("request", function (req, res) { static_reqest(req, res); });

server.listen(port, function (err) {

    if (err)
        console.error(err)
    else
        console.log("Webserver port:" + port + " pid:" + process.pid);
});

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function static_reqest(req, res) {

    var filename = req.url;

    if (!filename.length || filename.endsWith("/")) { filename += options.directory_index; }
    if (filename.startsWith("/")) { filename = filename.substr(1); }

    var subdomain = req.headers.host.replace(":" + options.port, "");
    subdomain = subdomain.replace(options.domain, "");
    if (subdomain.endsWith(".")) { subdomain = subdomain.substr(0, subdomain.length - 1); }
    var document_root = subdomain === "" ? options.document_root : options.subdomains[subdomain];

    if (document_root && req.method.toLocaleUpperCase() === "GET") {

        filename = path.resolve(__dirname, document_root, filename);
        static_file(filename, res, function () {

            filename = path.resolve(__dirname, options.document_root, options.pathToError_404);
            static_file(filename, res, function (exists) {

                if (!exists) {

                    not_found_content(req, res);
                }
            })
        });
    }
    else {
        not_found_content(req, res);
    }
}
/**
 * @param {string} filename
 * @param {http.ServerResponse} res
 * @param {()void} callback
 */
function static_file(filename, res, fn_not_found) {

    fs.exists(filename, function (exists) {

        if (exists) {

            var statusCode = filename.endsWith(path.parse(options.pathToError_404).base) ? 404 : 200;
            var mimeType = mimeTypes[path.extname(filename)];
            if (!mimeType) mimeType = "";
            res.writeHead(statusCode, { "Content-Type": mimeType });
            fs.createReadStream(filename).pipe(res);
        }
        else
            fn_not_found();
    });
}
/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function not_found_content(req, res) {

    console.info("Warning: 404 Not Found", {
        url: req.url,
        ip: req.socket.remoteAddress,
        userAgent: req.headers["user-agent"]
    });
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.write("404 Not Found Url: " + req.url + "\n");
    if (options.isDebug) {
        res.write("Headers: " + JSON.stringify(req.headers, null, 2) + "\n");
    }
    res.end();
}

module.exports = server;