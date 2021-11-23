"use strict";

require('log-report');

if (require("try-to-run")()) {
    // isMainThread
    return;
}

console.time("Time");
var options = require("config-sets").tiny_https_server;
options.subdomains = { test: "./public/test" };

//var server = require("tiny-https-server");
var server = require("./server.min.js");
// Console log
server.on("request", function (req, res, next) {
    console.timeLog("Time", `Url: ${req.headers.host}${req.url}`);
    next();
});
// Test page.
server.on("request", function (req, res, next) {
    if (req.url === "/test") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("Test page.");
        res.end();
    }
    else
        next();
});
// Simulated crash ...
server.on("request", function (req, res, next) {
    if (req.url === "/crash") {
        throw new Error("Simulated crash ...");
    }
    else
        next();
});


var port = options.port === 443 ? "" : ":" + options.port;
var urls = [
    `http://localhost${port}/`,
    `http://test.localhost${port}/`,
    `http://localhost${port}/test`,
    `http://test.localhost${port}/test`,
    `http://localhost${port}/home`
];

// Opens the URLs in the default browser.
while (urls.length) {
    require("browse-url")(urls.shift());
}