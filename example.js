var fs = require('fs');
var path = require('path');
var Interface = require('./index');

var ID = 'DNWS6QoYR1Q';

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
    console.log("Error:");
    console.log(err);
})
