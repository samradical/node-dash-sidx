var Q = require('bluebird');
var fs = require('fs');
var path = require('path');
var YT = require('ytdl-core');
var sh = require('shelljs');
var readDir = require('readdir');
var xml2js = require('xml2js');
var XMLHttpRequest = require('xhr2');
var SIDX = require('./lib/sidx');
//mp4 and m4a dash codes

//720p, 480p, 360p
var DASH_VIDEO_RESOLUTIONS = ['720p', '480p', '360p'];
var DASH_VIDEO_TAGS = ['136', '135', '134', '133'];
var DASH_AUDIO_TAGS = ['139', '140', '141'];
var VIDEO_PATH = '/watch?v=';
var VIDEO_BASE = 'https://www.youtube.com' + VIDEO_PATH;


var SidxInterface = (() => {
  var parser = new xml2js.Parser();

  function start(options) {
    options = options || {};

    if (options.audioOnly) {
      delete options.resolution;
    }

    if (options.resolution) {
      var startRes = DASH_VIDEO_RESOLUTIONS.indexOf(options.resolution);
      if (startRes >= 0) {
        var clone = [].concat(DASH_VIDEO_RESOLUTIONS);
        options.dashVideoResolutions = clone.splice(startRes, DASH_VIDEO_RESOLUTIONS.length);
      }
    }

    if (options.audioOnly && options.videoOnly) {
      options.videoOnly = true;
      options.audioOnly = false;
    }

    options.audioOnly = options.audioOnly || false;
    options.videoOnly = !options.audioOnly;
    options.container = options.container || 'mp4'

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
            resolve(data);
          }).catch(function(err) {
            reject();
          });
      });
    });
  }

  function chooseMediaFormat(formats, options) {
    var mimetpye = _getMimeType(options)
    console.log(mimetpye);
    //fs.writeFileSync(`d.json`, JSON.stringify(formats, null, 4), 'utf-8')
      //fs.writeSync('d.json', JSON.stringify(formats, null, 4))
      /*var choices = formats.filter(function(rep) {
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
              if (options.videoOnly) {
                  if (DASH_VIDEO_TAGS.indexOf(rep.itag) < 0) {
                      valid = false;
                  }
              } else if (options.audioOnly) {
                  if (DASH_AUDIO_TAGS.indexOf(rep.itag) < 0) {
                      valid = false;
                  }
              }
          }
          return valid;
      });*/
    var choices = formats.filter(function(rep) {
      var re = new RegExp(mimetpye);
      return rep.type.match(re)
    }).filter(choice => {
      return options.audioOnly === !!choice.audioEncoding
    })
    var filteredCorrectly = choices.filter(choice => {
      return choice.index
    })
    return new Q(function(resolve, reject) {
      if (filteredCorrectly.length) {
        if (options.chooseBest) {
          choices = choices.splice(0, 1);
        }
        //resolve(tryYoutubeDl(choices[0], options))
        resolve(Q.map(choices, (choice) => {
          _prepareData(choice)
          return getSidx(choice);
        }));
      } else if (options.youtubeDl) {
        resolve(tryYoutubeDl(choices[0], options))
      } else {
        resolve()
      }
    })
  }

  function tryYoutubeDl(object, options) {
    var id = options.id
    var videoUrl = VIDEO_BASE + id;
    var Out = {
      info: object,
      codecs: undefined,
      indexRange: undefined,
      url: object.url,
      sidx: undefined
    }
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
      var iTags = options.videoOnly ? DASH_VIDEO_TAGS : DASH_AUDIO_TAGS
      manifests.forEach(function(p) {
        var xml = fs.readFileSync(p, 'utf-8')
        parser.parseString(xml, function(err, result) {
          var adpatation = result.MPD.Period[0].AdaptationSet;
          var byMime = adpatation.filter(set => {
            return set.$.mimeType === mimetpye
          })[0]

          let _reps = byMime.Representation.filter(rep => {
            var _r = false
            var repVars = rep.$
            if (iTags.indexOf(repVars.id) > -1) {
              var segmentList = rep.SegmentList
              if (segmentList[0].SegmentURL[0].$.media.indexOf('range') > -1) {
                _r = true
              }
            }
            return _r
          })

          _reps.forEach(rep => {
            var repVars = rep.$
            if (iTags.indexOf(repVars.id) > -1 && !Out.codecs) {
              delete Out.info
              Out.url = rep.BaseURL[0]
              Out.codecs = repVars.codecs
              var segmentList = rep.SegmentList || rep.SegmentBase
              var indexRange
              if (segmentList[0].$) {
                let _ii = segmentList[0].$.indexRange.split('-')[1]
                indexRange = `0-${_ii}`
              } else {
                var _i = segmentList[0].SegmentURL[0].$.media.replace('range/', '').split('-')[0]
                var _iParsed = parseInt(_i, 10) - 1
                indexRange = `0-${_iParsed}`
              }
              /*console.log("===================================");
              console.log(Out);
              console.log("===================================");*/
              Out.indexRange = indexRange

              console.log(Out);
              sh.cd(__dirname)
                //sh.exec(`rm -rf ${_downloadDir}`)
              resolve(getSidx(Out))
            }
          })
        });
      })
    });
  }

  function _getMimeType(options) {
    return options.audioOnly ? `audio/${options.container}` : `video/${options.container}`;
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
