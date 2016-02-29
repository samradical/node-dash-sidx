var Q = require('bluebird');
var fs = require('fs');
var path = require('path');
var YT = require('ytdl-core');
var xml2js = require('xml2js');

//mp4 and m4a dash codes
var DASH_VIDEO_TAGS = ['136', '135', '134', '133'];
var DASH_AUDIO_TAGS = ['139', '140', '141'];
var VIDEO_PATH = '/watch?v=';
var VIDEO_BASE = 'https://www.youtube.com' + VIDEO_PATH;

'use strict';

var SidxInterface = (() => {
    var parser = new xml2js.Parser();

    function start(options) {
        options.audioonly = options.audioonly || false;
        options.videoonly = options.videoonly || true;
        var id = options.id;
        if (!id) {
            throw new Error('specify id in args: --id ');
            return;
        }
        return new Q(function(resolve, reject) {
            var url = VIDEO_BASE + id;
            YT.getInfo(url, function(err, info) {
                if (!info) {
                    throw new Error(`failed to get info on ${id}`);
                    reject();
                    return;
                }
                chooseMediaFormat(info.formats, options).then(function(data) {
                    resolve(data);
                }).catch(function(err) {
                    reject();
                });
            });
        });
    }

    function chooseMediaFormat(formats, options) {
        var mimetpye = options.audioonly ? 'audio/mp4' : 'video/mp4';
        var choices = formats.filter(function(rep) {
            var re = new RegExp(mimetpye);
            var valid = true;
            if (options.itag) {
                if (rep.itag !== options.itag) {
                    valid = false;
                }
            } else {
                if (options.videoonly) {
                    if (DASH_VIDEO_TAGS.indexOf(rep.itag) < 0 || !rep.index) {
                        valid = false;
                    }
                } else if (!options.audioonly) {
                    if (DASH_AUDIO_TAGS.indexOf(rep.itag) < 0 || !rep.index) {
                        valid = false;
                    }
                }
                if (!rep.type) {
                    return false;
                }
            }
            return rep.type.match(re) && valid;
        });
        return Q.map(choices, (choice) => {
            return getSidx(choice);
        });
    }

    //*********************
    //INDEX
    //*********************
    function getSidx(choice) {
        var url = choice.url;
        var cdex = choice.type.split('codecs=\"')[1];
        var codecs = cdex.substring(0, cdex.length - 1);
        var indexRange = "0-" + choice.index.split('-')[1];
        return new Q(function(resolve, reject) {
            var XMLHttpRequest = require('xhr2');
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.setRequestHeader("Range", "bytes=" + indexRange);
            xhr.responseType = 'arraybuffer';
            xhr.addEventListener("readystatechange", function() {
                if (xhr.readyState == xhr.DONE) { // wait for video to load
                    // Add response to buffer
                    var p = require('./sidx').parseSidx(xhr.response);
                    if (!p) {
                        reject('Failed on SIDX parse');
                    } else {
                        resolve({
                            codecs: codecs,
                            indexRange: indexRange,
                            url: choice.url,
                            sidx: p
                        });
                    }
                }
            }, false);
            xhr.send();
        });
    }
    return {
        start: start
    }
})();
module.exports = SidxInterface;