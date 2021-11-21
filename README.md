# tiny-https-server: Easy tiny https web server middleware.

[![npm-version](https://badgen.net/npm/v/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)
[![npm-week-downloads](https://badgen.net/npm/dw/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)

Easy tiny https web server middleware.
Easy to use and configure.
Handle subdomains.
Serving static files.

## Installing

`npm install tiny-https-server`

## Usage example

app.js
```js
"use strict";

if (require("try-to-run")()) {
    // isMainThread
    require('log-report').clear();
    return;
}

console.time("Time");
var options = require("config-sets").tiny_https_server;
options.subdomains = { test: "./public/test" };

var server = require("tiny-https-server");
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
```

## Config-sets file

config-sets.json
```json
{
  "production": {
    "tiny_https_server": {
      "domain": "localhost",
      "port": 443,
      "document_root": "./public/www",
      "directory_index": "index.html",
      "pathToError_404": "./error_404.html",
      "pathToPrivkey": "./cert/localhost-key.pem",
      "pathToCert": "./cert/localhost-cert.pem",
      "subdomains": {
        "test": "./public/test"
      }
    }
  },
  "development": {
    "tiny_https_server": {
      "subdomains": {
        "test": "./public/test"
      }
    }
  }
}
```

## License

[MIT](LICENSE)

Copyright (c) 2021 Manuel L&otilde;hmus <manuel@hauss.ee>
