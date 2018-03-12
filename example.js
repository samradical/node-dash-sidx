var fs = require('fs');
var path = require('path');
var Interface = require('./index');

var ID = 'ij13CccWTzs';

var options = {
    id:ID,
    itags:['136']
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
