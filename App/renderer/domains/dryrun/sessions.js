function createSessionRegistry(storage) {
  const key = (project) => 'florde-dryrun:' + project;
  function get(project) {
    const raw = storage.get(key(project));
    return raw ? JSON.parse(raw) : null;
  }
  function put(project, session) {
    storage.set(key(project), JSON.stringify(session));
  }
  return {
    get,
    start(project, workspace) {
      if (get(project)) throw new Error('dry run already active for ' + project);
      const session = { project, state: 'active', workspace, ops: [], startedAt: Date.now(), summary: null };
      put(project, session);
      return session;
    },
    addOp(project, op) {
      const s = get(project);
      if (!s || (s.state !== 'active' && s.state !== 'review')) throw new Error('no active session for ' + project);
      s.ops.push({ at: Date.now(), ...op });
      put(project, s);
    },
    finish(project, summary) {
      const s = get(project);
      if (!s || s.state !== 'active') throw new Error('no active session for ' + project);
      s.state = 'review';
      s.summary = summary || null;
      put(project, s);
    },
    activate(project) {
      const s = get(project);
      if (!s || s.state !== 'review') throw new Error('no review session for ' + project);
      s.state = 'active';
      put(project, s);
      return s;
    },
    apply(project) {
      if (!get(project)) throw new Error('no session for ' + project);
      storage.del(key(project));
    },
    reject(project) {
      if (!get(project)) throw new Error('no session for ' + project);
      storage.del(key(project));
    },
    listOrphans(knownProjects) {
      const known = new Set(knownProjects || []);
      const out = [];
      const keys = typeof storage.keys === 'function' ? storage.keys() : [];
      for (const k of keys) {
        if (!k.startsWith('florde-dryrun:')) continue;
        const s = get(k.slice('florde-dryrun:'.length));
        if (s && !known.has(s.project)) out.push({ project: s.project, path: s.workspace.path, kind: s.workspace.kind });
      }
      return out;
    },
  };
}

export { createSessionRegistry };
export default { createSessionRegistry };
if (typeof window !== 'undefined') window.__dryrunSessions = { createSessionRegistry };
