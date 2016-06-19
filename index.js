var Q = require('bluebird');
var fs = require('fs');
var path = require('path');
var YT = require('ytdl-core');
var sh = require('shelljs');
var rimraf = require('rimraf');
var readDir = require('readdir');
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


var SidxInterface = (() => {
    var parser = new xml2js.Parser();

    function start(options) {
        options = options || {};

        if (options.audioonly) {
            delete options.resolution;
        }

        if (options.resolution) {
            var startRes = DASH_VIDEO_RESOLUTIONS.indexOf(options.resolution);
            if (startRes >= 0) {
                var clone = [].concat(DASH_VIDEO_RESOLUTIONS);
                options.dashVideoResolutions = clone.splice(startRes, DASH_VIDEO_RESOLUTIONS.length);
            }
        }

        if (options.audioonly && options.videoonly) {
            options.videoonly = true;
            options.audioonly = false;
        }

        options.audioonly = options.audioonly || false;
        options.videoonly = !options.audioonly;

        options.chooseBest = options.chooseBest || false;

        return new Q(function(resolve, reject) {

            var id = options.id;
            if (!id) {
                reject('specify id in args: --id ');
                return;
            }
            var url = VIDEO_BASE + id;
            YT.getInfo(url, function(err, info) {
                if (!info) {
                    reject('failed to get info on', id);
                    return;
                }
                chooseMediaFormat(info.formats, options)
                    .then(function(data) {
                        if (!data.length) {
                            resolve(tryYoutubeDl(url, id, options))
                        } else {
                            resolve(data);
                        }
                    }).catch(function(err) {
                        reject();
                    });
            });
        });
    }

    function chooseMediaFormat(formats, options) {
        var mimetpye = _getMimeType(options)
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
            }
            if (!rep.type) {
                return false;
            }
            return rep.type.match(re) && valid;
        });
        if (options.chooseBest) {
            choices = choices.splice(0, 1);
        }
        return Q.map(choices, (choice) => {
            _prepareData(choice)
            return getSidx(choice);
        });
    }


    function tryYoutubeDl(videoUrl, id, options) {
        return new Q(function(resolve, reject) {
            var _downloadDir = path.join(__dirname, id)
            var mimetpye = _getMimeType(options)
            if (fs.existsSync(_downloadDir)) {
                sh.exec(`rm -rf ${_downloadDir}`)
            }
            fs.mkdirSync(_downloadDir)
            sh.cd(_downloadDir)
            var _cmd = `youtube-dl ${videoUrl} --skip-download -v --write-pages`
            var run = sh.exec(_cmd);
            if (run.code !== 0) {
                err = new Error('Command failed ' + _cmd);
            }
            var filesArray = readDir.readSync(_downloadDir, ['**.dump'], readDir.ABSOLUTE_PATHS);
            var manifests = filesArray.filter(function(p) {
                return p.indexOf('manifest') > -1
            })
            var Out = {
                info: undefined,
                codecs: undefined,
                indexRange: undefined,
                url: undefined,
                sidx: undefined
            }
            manifests.forEach(function(p) {
                var xml = fs.readFileSync(p, 'utf-8')
                parser.parseString(xml, function(err, result) {
                    var adpatation = result.MPD.Period[0].AdaptationSet;
                    var byMime = adpatation.filter(set => {
                        return set.$.mimeType === mimetpye
                    })[0]
                    var rep = byMime.Representation[0].$
                    Out.url = byMime.Representation[0].BaseURL[0]
                    Out.codecs = rep.codecs
                    var segmentList = byMime.Representation[0].SegmentList
                    var _i = segmentList[0].SegmentURL[0].$.media.replace('range/', '').split('-')[0]
                    var _iParsed = parseInt(_i, 10) - 1
                    var indexRange = `0-${_iParsed}`
                    Out.indexRange = indexRange
                    sh.cd(__dirname)
                    sh.exec(`rm -rf ${_downloadDir}`)
                    resolve(getSidx(Out))
                });
            })
        });
    }

    function _getMimeType(options) {
        return options.audioonly ? 'audio/mp4' : 'video/mp4';
    }

    //*********************
    //INDEX
    //*********************

    /*
    prepare the data coming from ytdl core
    */
    function _prepareData(choice) {
        var url = choice.url;
        var cdex, codecs, indexRange
        if (choice.type) {
            cdex = choice.type.split('codecs=\"')[1];
            codecs = cdex.substring(0, cdex.length - 1);
            choice.codecs = codecs
        }
        if (choice.index) {
            indexRange = "0-" + choice.index.split('-')[1];
            choice.indexRange = indexRange
        }
        return choice
    }

    /*
    {
        url
        codecs
        indexRange
        data
    }
    */
    function getSidx(choice) {
        return new Q(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', choice.url);
            xhr.setRequestHeader("Range", "bytes=" + choice.indexRange);
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
                            codecs: choice.codecs,
                            indexRange: choice.indexRange,
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