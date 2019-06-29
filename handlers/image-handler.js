// vim: tabstop=2 shiftwidth=2 expandtab
//

'use strict'

const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');
const sanitize = require('sanitize-filename');

const imageProcessing = require('fast-image-processing');

const debug = require('debug')('responsive-photo-gallery:image-handler');
const debugErr = require('debug')('responsive-photo-gallery:image-handler:error');

// Alternative to sanitize for paths
const sanitizeToRoot = (rootDir, subDir) => {
  var s = path.resolve(path.join(path.resolve(rootDir), path.normalize(subDir)));
  if (s.startsWith(path.resolve(rootDir))) {
    return s;
  }
  return '';
}

const walkDir = (basedir, dir = '.', filelist = []) => {
  let files = fs.readdirSync(path.join(basedir, dir));
  files.forEach((file) => {
    try {
      let stat = fs.statSync(path.join(basedir, dir, file));
      if (stat.isDirectory()) {
        filelist = walkDir(basedir, path.join(dir, file), filelist);
      } else {
        filelist.push(path.join(dir, file));
      }
    } catch(e) {
      //ignore failed stat, not a directory or file, probably failed symlink
    }
  });
  return filelist;
}

const getThumbBuffer = (image_path, thumb_path, thumb, _cb) => {

  const [ width, height ] = thumb.split('x');

  // make sure we have valid input
  const san_width = parseInt(width);
  const san_height = parseInt(height);
  if (+width !== san_width || +height !== san_height) {
    return _cb(new Error('Invalid Dimensions'), undefined, undefined);
  }

  return imageProcessing.cacheThumbAndGetBuffer(image_path, thumb_path, san_width, san_height, (err, thumb_buffer, thumb_content_type) => {
    if (err) {
      return _cb(err, undefined, undefined);
    }

    return _cb(undefined, thumb_buffer, thumb_content_type);
  });

}

const getImageBuffer = (image_path, _cb) => {

  return imageProcessing.getNormalizedImageBuffer(image_path, (err, image_buffer, image_content_type) => {
    if (err) {
      return _cb(err, undefined, undefined);
    }

    return _cb(undefined, image_buffer, image_content_type);
  });

}

const sanitizeRequiredArguments = (args, _cb) => {

  var san_args = [];
  for (let i = 0; i < args.length; i++) {
    // Required arguments
    if (!args[i]) {
      return _cb(new Error('missing required argument'), undefined);
    }
    const san_arg = sanitize(args[i]);
    if (!san_arg) {
      return _cb(new Error('malformed argument'), undefined);
    }
    san_args.push(san_arg);
  }

  return _cb(undefined, san_args);
}

const limitResults = (list, num_results, distributed) => {

  // sanitize input
  // make sure we have valid input
  const san_num_results = parseInt(num_results);
  if (+num_results !== san_num_results) {
    return [];
  }
  const san_distributed = (distributed === "true");

  // return a first chunk if not distributing results
  if (!san_distributed) {
    return list.slice(0, san_num_results);
  }

  let ret_list = []
  if (san_num_results) {
    const delta = san_num_results >= list.length ? 1 : Math.floor(list.length / san_num_results);
    if (delta) {
      for (let i = 0; i < list.length && ret_list.length < san_num_results; i=i+delta) {
        //debug(i, delta, san_num_results, list.length);
        ret_list.push(list[i]);
      }
    }
  }
  return ret_list;
}

class imageHandler {
  constructor(imagePath, thumbPath=false) {
    this.imagePath = imagePath;
    this.thumbPath = thumbPath;
  }

  image(album, image, thumb, _cb) {

    sanitizeRequiredArguments([album], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        }, undefined, undefined);
      }
      const [album] = args;

      const image_path = sanitizeToRoot(this.imagePath, path.join(album, image));

      // If they want a thumbnail, generate, cache, and return it instead
      if (thumb) {
        const san_thumb = sanitize(thumb);
        let thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, thumb, image));
        // TODO find a better way to do this rather than using extension
        if (path.extname(image).toLowerCase() == '.mov') {
          thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, 'video', thumb, image));
        }
        return getThumbBuffer(image_path, thumb_path, san_thumb, (err, thumb_buffer, thumb_content_type) => {
          if (err) {
            // return the original image if there is an error
            return getImageBuffer(image_path, (err, image_buffer, image_content_type) => {
              if (err) {
                return _cb({
                  'error': {
                    'code': 500,
                    'message': 'Unable to get backup image',
                  }
                }, undefined, undefined);
              }
              return _cb(undefined, image_buffer, image_content_type);
            });
          }
          return _cb(undefined, thumb_buffer, thumb_content_type);
        });
      }

      return getImageBuffer(image_path, (err, image_buffer, image_content_type) => {
        if (err) {
          return _cb({
            'error': {
              'code': 500,
              'message': 'Unable to get image',
            }
          }, undefined, undefined);
        }
        return _cb(undefined, image_buffer, image_content_type);
      });
    });

  }

  video(album, image, _cb) {

    sanitizeRequiredArguments([album], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        }, undefined, undefined);
      }
      const [album] = args;

      const vid_path = sanitizeToRoot(this.imagePath, path.join(album, image));

      return _cb(undefined, vid_path);
    });

  }

  thumbnails(album, thumb, image, num_results, distributed, _cb) {

    sanitizeRequiredArguments([album, thumb], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      const [album, thumb] = args;

      let album_path = path.join(this.imagePath, album);


      // If they only want a single thumbnail, generate, cache, and return it instead
      if (image) {
        const image_path = sanitizeToRoot(this.imagePath, path.join(album, image));
        const san_thumb = sanitize(thumb);
        let thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, thumb, image));
        // TODO find a better way to do this rather than using extension
        if (path.extname(image).toLowerCase() == '.mov') {
          thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, 'video', thumb, image));
        }
        return getThumbBuffer(image_path, thumb_path, san_thumb, (err, thumb_buffer, thumb_content_type) => {
          if(err) {
            debugErr(err);
            return _cb({
              'error': {
                'code': 500,
                'message': 'Unable to get thumb image',
              }
            }, undefined, undefined);
          }
          let images = {};
          images[image] = {
            // TODO: these are not necessarily png files
            base64tag: "data:" + thumb_content_type + ";base64," + thumb_buffer.toString('base64'),
          }
          return _cb({
            'result': images,
          })
        })
      }

      let files = walkDir(album_path);
 
      // No files to loop on
      if (!files.length) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'No Files Processed',
          }
        });
      }

      // Process only a subset if requested
      if (num_results) {
        files = limitResults(files, num_results, distributed);
      }
      
      let images = {};
      Promise.map(files, (file) => {

        const san_thumb = sanitize(thumb);
        const image_path = path.join(album_path, file);
        let thumb_path = path.join(this.thumbPath, album, thumb, file);
        if (path.extname(file).toLowerCase() == '.mov') {
          thumb_path = sanitizeToRoot(this.thumbPath, path.join(album, 'video', thumb, file));
        }
        return new Promise((resolve, reject) => {
          getThumbBuffer(image_path, thumb_path, san_thumb, (err, thumb_buffer, thumb_content_type) => {
            if(err) {
              debugErr(err);
              return resolve();
            }
            images[file] = {
              // TODO: these are not necessarily png files
              base64tag: "data:" + thumb_content_type + ";base64," + thumb_buffer.toString('base64'),
            }
            return resolve()
          })
        })
      }, { concurrency: 16 })
      .then(() => {
        if (Object.keys(images).length === 0) {
          return _cb({
            'error': {
              'code': 500,
              'message': 'No Images Processed',
            }
          })
        }
        return _cb({
          'result': images,
        })
      }).catch((err) => {
        debugErr(err.stack);
        return _cb({
          'error': {
            'code': 500,
            'message': 'Internal error: ' + err,
          }
        })
      })
    })
  }

  list(album, num_results, distributed, _cb) {

    sanitizeRequiredArguments([album], (err, args) => {
      if (err || !args) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      const [album] = args;

      let album_path = path.join(this.imagePath, album);
      let files = walkDir(album_path);

      // No files to loop on
      if (!files.length) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'No Files Processed',
          }
        });
      }

      // Process only a subset if requested
      if (num_results) {
        files = limitResults(files, num_results, distributed);
      }

      let images = {};
      Promise.map(files, (file) => {
        const image_path = path.join(album_path, file);

        return new Promise((resolve, reject) => {
          imageProcessing.getMetadata(image_path, (err, image_metadata) => {
            if(err) {
              debugErr(err);
              return resolve();
            }
            // TODO description
            image_metadata['description'] = file;
            images[file] = image_metadata;
            return resolve()
          })
        })
      }, { concurrency: 16 })
      .then(() => {
        if (Object.keys(images).length === 0) {
          return _cb({
            'error': {
              'code': 500,
              'message': 'No Images Processed',
            }
          })
        }
        return _cb({
          'result': images,
        })
      }).catch((err) => {
        debugErr(err.stack);
        return _cb({
          'error': {
            'code': 500,
            'message': 'Internal error: ' + err,
          }
        })
      })
    });

  }

  albums(_cb) {
 
    fs.readdir(this.imagePath, (err, files) => {
      if (err) {
        return _cb({
          'error': {
            'code': 500,
            'message': err.message,
          }
        });
      }
      // No files to loop on
      if (!files.length) {
        return _cb({
          'error': {
            'code': 500,
            'message': 'No Albums Processed',
          }
        });
      }

      let dirs = {};
      for (let i = 0; i < files.length; i++) {
        try {
          let file = files[i];
          if (fs.statSync(path.join(this.imagePath, file)).isDirectory()) {
            dirs[file] = {description: file};
          }
        } catch(e) {
          //ignore failed stat, not a directory or file, probably failed symlink
        }
      }

      return _cb({
        'result': dirs,
      });

    });
  }
}

module.exports = imageHandler;

