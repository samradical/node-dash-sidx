# youtube-dash-sidx
Get the The Segment Index box (sidx) of a youtube video in json.
The application would be if you wanted to use this with a video mediasource by requesting indivdual byteRange references from the SIDX and appending the buffer to the source.

[media source](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource)

[dash tutorial](https://msdn.microsoft.com/en-us/library/dn551368(v=vs.85).aspx)

It is promised with bluebird.

Please see the example.js for use.

You will need [youtube-dl](https://github.com/rg3/youtube-dl/blob/master/README.md#readme) because sometimes, especially for copywrited content, youtube does not give the index ranges lightly, so we need to leverage this library to download the manifests.

