var fs = require('fs');
var path = require('path');
var Interface = require('./index.new');

var ID = 'jbGTggv8IEI';

/*
All OPTIONS
    id:ID,
    audioOnly:false,
    videoOnly:true,
    resolution: //'720p', '480p', '360p'
    chooseBest:true,
    youtubeDl:false // to leverage youtube-dl
*/


var options = {
    id:ID,
    itags:['140']
};

Interface.start(options)
.then(results => {
    console.log(results);
    //fs.writeFileSync(path.join(process.cwd(), `${ID}.json`), JSON.stringify(results, null, 4), 'utf-8');
})
.catch(err=>{
    console.log(err);
})
