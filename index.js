var Q = require('bluebird');
var fs = require('fs');
var path = require('path');
var YT = require('ytdl-core');
var xml2js = require('xml2js');
var XMLHttpRequest = require('xhr2');

var SIDX = require('./lib/sidx');
//mp4 and m4a dash codes

//720p, 480p, 360p
var DASH_VIDEO_RESOLUTIONS = ['720p', '480p', '360p', '240p'];
var DASH_VIDEO_TAGS = ['136', '135', '134', '133'];
var DASH_AUDIO_TAGS = ['139', '140', '141'];
var VIDEO_PATH = '/watch?v=';
var VIDEO_BASE = 'https://www.youtube.com' + VIDEO_PATH;

'use strict';

var SidxInterface = (() => {
    var parser = new xml2js.Parser();

    function start(options) {
        options = options || {};

        if(options.audioonly){
            delete options.resolution;
        }

        if (options.resolution) {
            var startRes = DASH_VIDEO_RESOLUTIONS.indexOf(options.resolution);
            if (startRes >= 0) {
                options.dashVideoResolutions = [].concat(DASH_VIDEO_RESOLUTIONS.splice(startRes, DASH_VIDEO_RESOLUTIONS.length));
            }
        }

        if (options.audioonly && options.videoonly) {
            options.videoonly = true;
            options.audioonly = false;
        }

        options.audioonly = options.audioonly || false;
        options.videoonly = !options.audioonly;

        options.chooseBest = options.chooseBest || false;

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
            if (options.resolution) {
                if (options.dashVideoResolutions.indexOf(rep.resolution) < 0 || !rep.index) {
                    valid = false;
                }
            } else if (options.itag) {
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
        if (options.chooseBest) {
            choices = choices.splice(0, 1);
        }
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
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.setRequestHeader("Range", "bytes=" + indexRange);
            xhr.responseType = 'arraybuffer';
            xhr.addEventListener("readystatechange", function() {
                if (xhr.readyState == xhr.DONE) { // wait for video to load
                    // Add response to buffer
                    var p = SIDX.parseSidx(xhr.response);
                    if (!p) {
                        reject('Failed on SIDX parse');
                    } else {
                        resolve({
                            info: choice,
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