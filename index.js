var spawn = require('cross-spawn')
var denodeify = require('denodeify')
var rimraf = denodeify(require('rimraf'))
var mkdirp = denodeify(require('mkdirp'))
var fetch = require('node-fetch')
var packages = require('./topPackages')
var path = require('path')
var url = require('url')
var present = require('present')
var writeFile = denodeify(require('fs').writeFile)

var TIMEOUT = 300000 // timeout and fail after this many milliseconds

var IGNORE = [
  'npm',             // slow
  'pm2',             // fails
  'webpack',         // slow
  'yo',              // slow
  'gulp-sourcemaps', // slow
  'karma',           // slow
  'redis',           // requires redis?
  'mysql',           // requires mysql?
  'forever'          // ties up resources and doesn't delete them
]

function spawnAndRedirectConsole (cmd, args, opts) {
  return new Promise((resolve, reject) => {
    var child = spawn(cmd, args, opts)
    var done = false

    child.on('close', code => {
      if (done) {
        return
      }
      done = true
      if (code === 0) {
        resolve()
      } else {
        reject(new Error('rejected with code: ' + code))
      }
    })

    child.on('error', err => {
      console.error(err)
      console.error(err.stack)
    })

    child.stdout.on('data', data => console.log(data.toString('utf-8').replace(/\n$/, '')))
    child.stderr.on('data', data => console.error(data.toString('utf-8').replace(/\n$/, '')))

    setTimeout(() => {
      if (done) {
        return
      }
      done = true
      reject(new Error(`timed out after ${TIMEOUT}ms`))
      child.kill('SIGINT')
    }, TIMEOUT)
  })
}

function spawnCommand (cmd, args, opts) {
  console.log(cmd, args, {cwd: opts.cwd})
  var start = present()
  return spawnAndRedirectConsole(cmd, args, opts).then(() => {
    return {passed: true, time: present() - start}
  }).catch(err => {
    console.error(err)
    return {passed: false, time: present() - start}
  })
}

var testResults = []

rimraf('./workspace').then(() => {
  return mkdirp('./workspace')
}).then(() => {
  var chain = Promise.resolve()
  packages.forEach(pkg => {
    chain = chain.then(() => {
      if (IGNORE.indexOf(pkg) !== -1) {
        console.error(`skipping package ${pkg} because it takes too long or is faily`)
        testResults.push({name: pkg, skipped: true})
        return
      }
      return fetch(`http://registry.npmjs.org/${pkg}`).then(resp => resp.json()).then(json => {
        if (!json.repository) {
          console.error(`skipping package ${pkg} because no repository`)
          testResults.push({name: pkg, skipped: true})
          return
        }
        var repo = json.repository.url || json.repository
        repo = repo.replace('git+https', 'https')
        var gitPromise = spawnCommand(
          'git',
          ['clone', '--depth', '1', '--single-branch', '--branch', 'master', repo],
          {
            cwd: 'workspace',
            env: process.env
          })
        return gitPromise.then(() => {
          var paths = url.parse(repo).path.split('/')
          var dir = paths[paths.length - 1].replace(/.git$/, '')
          var pkgResult = {name: pkg, repo: repo}
          return spawnCommand('npm', ['install'], {
            cwd: path.join('workspace', dir),
            env: process.env
          }).then(res => {
            pkgResult.npmInstallPassed = res.passed
            pkgResult.npmInstallTime = res.time
            return spawnCommand('npm', ['test'], {
              cwd: path.join('workspace', dir),
              env: process.env
            })
          }).then(res => {
            pkgResult.npmTestPassed = res.passed
            pkgResult.npmTestTime = res.time
            testResults.push(pkgResult)
            console.log(JSON.stringify(testResults, null, '  '))
          }).then(() => {
            return rimraf(dir)
          })
        })
      })
    })
  })
  return chain.then(() => {
    return writeFile('results.json', JSON.stringify(testResults, null, '  '), 'utf-8')
  })
}).catch(err => {
  console.error(err)
  console.error(err.stack)
  process.exit(1)
})
