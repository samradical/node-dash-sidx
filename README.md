# youtube-dash-sidx
Get the The Segment Index box (sidx)  of a youtube video in json.
The application would be if you wanted to use this with a video mediasource by requesting indivdual byteRange references from the SIDXand appending the buffer to the source.

https://developer.mozilla.org/en-US/docs/Web/API/MediaSource
https://msdn.microsoft.com/en-us/library/dn551368(v=vs.85).aspx

It is promise ready with bluebird.

`npm i`

run with `node example.js --id <videoId> --audioonly true <or> --videoonly true`

options, eg:
`--itag 136`
`--audioonly true`
`--videoonly true`
