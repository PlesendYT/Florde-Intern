const { DockerBackend } = require('./docker');

class PodmanBackend extends DockerBackend {
  get type() { return 'podman'; }
  get label() { return 'Podman Sandbox'; }
  get description() { return 'Daemonlose Container-Ausführung. Rootless by default, kompatibel mit Docker-Befehlen.'; }
  get _binary() { return 'podman'; }
}

module.exports = { PodmanBackend };
