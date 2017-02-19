var Q = require('bluebird');
const exec = require('child_process').exec
var fs = require('fs');
var path = require('path');
var YT = require('ytdl-core');
var readDir = require('readdir');
var _ = require('lodash');
var xml2js = require('xml2js');
var xhr = require('xhr-request');
var SIDX = require('./lib/sidx');
//mp4 and m4a dash codes

//720p, 480p, 360p
var DASH_VIDEO_RESOLUTIONS = ['720p', '480p', '360p', '240p', '144p'];
var DASH_VIDEO_TAGS = ['136', '135', '134', '133', '160'];
var DASH_AUDIO_TAGS = ['139', '140', '141'];
var VIDEO_PATH = '/watch?v=';
var VIDEO_BASE = 'https://www.youtube.com' + VIDEO_PATH;
var ITAG_DASH_TRESHOLD = 100

const YOUTUBE_DL_PATH = 'bin/youtube-dl'


/*
probably could scrap ytdl core and just use the itags with youtube-dl

*/

var SidxInterface = (() => {

  var youtubeDlPath = 'youtube-dl'
  var _tempSaveDir = __dirname
    /*
    API
    */
  function start(options) {
    options = options || {};
    if (options.audioOnly) {
      delete options.resolution;
    }

    if (options.youtubeDlPath) {
      youtubeDlPath = options.youtubeDlPath
    }

    if (options.resolution) {
      var startRes = DASH_VIDEO_RESOLUTIONS.indexOf(options.resolution);
      if (startRes >= 0) {
        var clone = [].concat(DASH_VIDEO_RESOLUTIONS);
        options.dashVideoResolutions = clone.splice(startRes, DASH_VIDEO_RESOLUTIONS.length);
      }
    }

    /*if (options.audioOnly && options.videoOnly) {
      options.videoOnly = true;
      options.audioOnly = false;
    }*/

    if (typeof options.youtubeDl === 'undefined') {
      options.youtubeDl = true
    }

    if (typeof options.chooseBest === 'undefined') {
      options.chooseBest = true
    }

    if (typeof options.videoOnly === 'undefined') {
      options.videoOnly = true
    }

    options.videoOnly = Boolean(options.videoOnly)
    options.audioOnly = Boolean(options.audioOnly)

    options.audioOnly = options.audioOnly;
    options.videoOnly = options.videoOnly;
    options.container = options.container || 'mp4'


    return new Q((resolve, reject) => {

      var id = options.id || options.videoId;
      if (!id) {
        reject('specify id in args: --id ');
        return;
      }
      var url = VIDEO_BASE + id;
      console.log(`Requesting info for ${url}`);
      /*
      TODO: timeout
      */
      YT.getInfo(url, function(err, info) {
        if (!info) {
          reject(`failed to get info on ${id}`);
        } else {
          console.log(`Got info for ${id}`);
          chooseMediaFormat(info.formats, options)
            .then(function(data) {
              resolve(data);
            }).catch(function(err) {
              reject(err);
            });
        }
      });
    });
  }

  function getURL(videoId, itag, remote = {}) {
    console.log(`getURL ${videoId} ${itag}`);
    console.log(remote);
    console.log('\n');

    return new Q((resolve, reject) => {

      if (remote.url) {
        xhr(remote.url, {
          method: 'GET',
          json: true,
          query: {
            itag: itag,
            url: `${VIDEO_BASE}${videoId}`
          }
        }, (err, data, response) => {
          if (err) {
            console.log(err);
            reject(err)
          } else {
            resolve(data)
          }
        })
      } else {
        var _cmd = `${youtubeDlPath} ${VIDEO_BASE}${videoId} --skip-download -f ${itag} -g -q`
        var run = exec(_cmd, (code, stdout, stderr) => {
          if (stderr) {
            reject(stderr)
          } else {
            resolve(stdout)
          }
        });
      }
    });
  }

  function setTempSaveDir(dir) {
    _tempSaveDir = dir
  }

  //******************
  //PRIVATE
  //******************


  function chooseMediaFormat(formats, options) {
    var mimetpye = _getMimeType(options)
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


    var choices = formats.filter(choice => {
        return options.container === choice.container
      }).filter(choice => {
        //itag eval, remove the non dashed ones
        return parseInt(choice.itag, 10) > ITAG_DASH_TRESHOLD
      })
      .filter(choice => {
        return options.audioOnly === !!choice.audioEncoding
      })
      /*
          filter(function(rep) {
            var re = new RegExp(mimetpye);
            console.log(rep.type);
            console.log(rep);
            if(!rep.type){
              return false
            }
            return rep.type.match(re)
          }).filter(choice => {
            return options.audioOnly === !!choice.audioEncoding
          })*/


    //ones that have an index range
    var filteredCorrectly = choices.filter(choice => {
      return choice.index
    })

    if (options.resolution) {

      let _r = [...DASH_VIDEO_RESOLUTIONS]
      let _resolutionSelection = _r.slice(DASH_VIDEO_RESOLUTIONS.indexOf(options.resolution))

      filteredCorrectly = _.compact(_.flatten(_resolutionSelection.map(resolution => {
        return [...filteredCorrectly].map(item => {
          if (item.resolution === resolution) {
            return item
          } else {
            null
          }
        })
      })))

      /*
      Filter and make lowest at top
      */
      if (!filteredCorrectly.length) {
        filteredCorrectly = choices.filter(choice => {
          return choice.index
        }).reverse()
        if (!options.chooseBest) {
          filteredCorrectly.reverse()
        }
      }
    }

    return new Q((resolve, reject) => {
      console.log(filteredCorrectly);
      if (filteredCorrectly.length) {
        console.log(`Got a match with an index range for ${options.id}`);
        //pick top, length 1
        let _choice = filteredCorrectly.splice(0, 1)[0];
        _choice.videoId = options.id
        _prepareData(_choice)
        resolve(getSidx(_choice))
          /*resolve(Q.map(_choices, (choice) => {
              _prepareData(choice)
              return getSidx(choice);
          })[0]);*/
      } else if (options.youtubeDl) {
        console.log(`Trying youtubeDl for ${options.id}`);
        if (!options.chooseBest) {
          choices.reverse()
        }
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
      videoId: options.id,
      sidx: undefined
    }
    return new Q((resolve, reject) => {
      var mimetpye = _getMimeType(options)
      var _c = `${youtubeDlPath} ${videoUrl} --skip-download -v --write-pages`
      console.log(_c);
      let _cmd = exec(_c)
      _cmd.on('exit', (code) => {
        console.log(code);
        var filesArray = readDir.readSync(process.cwd(), ['**.dump'], readDir.ABSOLUTE_PATHS);
        var firstFile = [filesArray.shift()]
        filesArray.forEach(manifest => {
          try {
            fs.unlinkSync(manifest)
          } catch (e) {

          }
        })
        var parser = new xml2js.Parser();
        var videoiTags = options.videoOnly ? DASH_VIDEO_TAGS : []
        var audioiTags = options.audioOnly ? DASH_AUDIO_TAGS : []
        iTags = [...videoiTags, ...audioiTags ]
        console.log(iTags);
        console.log('\n');
        firstFile.forEach(function(p) {

            fs.readFile(p, 'utf-8', (err, data) => {
              parser.parseString(data, (err, result) => {
                var adpatation = result.MPD.Period[0].AdaptationSet;
                var byMime = adpatation.filter(set => {
                  return set.$.mimeType === mimetpye
                })[0]

                fs.unlinkSync(p)

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

                if (options.all) {
                  resolve(

                    Q.map(_reps, rep => {

                      let _o = _.assign({}, Out)
                      var repVars = rep.$
                      _o.url = rep.BaseURL[0]
                      _o.codecs = repVars.codecs
                      _o.resolution = `${repVars.height}p`
                      _o.itag = _sniffItagFrom(_o.url) //DASH_VIDEO_TAGS[DASH_VIDEO_RESOLUTIONS.indexOf(_o.resolution)]
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
                      _o.indexRange = indexRange
                      _o.youtubeDl = true
                      return getSidx(_o)

                    })

                  )
                } else {
                  _reps.forEach(rep => {
                    var repVars = rep.$
                    if (iTags.indexOf(repVars.id) > -1 && !Out.codecs) {
                      delete Out.info
                      Out.url = rep.BaseURL[0]
                      Out.codecs = repVars.codecs
                      Out.resolution = `${repVars.height}p`
                      Out.itag = _sniffItagFrom(Out.url) //DASH_VIDEO_TAGS[DASH_VIDEO_RESOLUTIONS.indexOf(Out.resolution)]
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
                      Out.indexRange = indexRange
                      Out.youtubeDl = true
                      resolve(getSidx(Out))
                    }
                  })
                }

              });
            })
          })
          //}
      });
    });
  }

  function _runYoutubeDlCommand() {

  }

  function _sniffItagFrom(dumpUrl) {
    let itag = dumpUrl.split('itag/')[1].substring(0, 3)
    console.log(itag);
    return itag
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

  function _doSidxXhr(choice, resolve, reject, count = 0) {
    let { url, indexRange } = choice
    xhr(choice.url, {
      method: 'GET',
      responseType: 'arraybuffer',
      headers: {
        'Range': `bytes=${choice.indexRange}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36'
      },
    }, function(err, data, response) {
      if (err) {
        console.log(err);
        reject(err)
      } else {
        var p = SIDX.parseSidx(data);
        if (!p) {
          reject(`Failed on SIDX parse for ${choice.videoId}`);
        } else {
          console.log(`Parsed SIDX for ${choice.videoId}`);
          resolve({
            info: choice,
            youtubeDl: !!choice.youtubeDl,
            codecs: choice.codecs,
            indexRange: choice.indexRange,
            url: choice.url,
            videoId: choice.videoId,
            sidx: p
          });
        }
      }
    })
  }

  function getSidx(choice) {
    return new Q(function(resolve, reject) {
      _doSidxXhr(choice, resolve, reject)
    });
  }

  function setYoutubeDLPath(p) {
    youtubeDlPath = p
  }

  return {
    start: start,
    getURL: getURL,
    setYoutubeDLPath: setYoutubeDLPath,
    setTempSaveDir: setTempSaveDir
  }

})();

module.exports = SidxInterface;
