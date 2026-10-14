// Pure policy for the two API enablements only. No network, Auth, CLI adapter or
// five-Function deployment enforcement is installed by importing this module.
export const API_PROJECT = 'filmovy-kviz-v2-staging';
export const API_PROJECT_NUMBER = '177615774316';
export const API_SERVICES = Object.freeze(['cloudtasks.googleapis.com', 'secretmanager.googleapis.com']);
const ORIGIN = 'https://serviceusage.googleapis.com/v1/';
const FRESH_MS = 5 * 60_000, WINDOW_MS = 15 * 60_000, POLL_MS = 5000, MAX_POLLS = 12;
const need = (condition, code) => { if (!condition) throw Error(code); };
function closed(value, keys) {
  need(value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'API_POLICY_SHAPE');
}
function time(value) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value), 'API_POLICY_TIME');
  const parsed = Date.parse(value);
  need(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, 'API_POLICY_TIME');
  return parsed;
}
function reference(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/u.test(value), 'API_POLICY_REFERENCE');
}
const resource = service => `projects/${API_PROJECT_NUMBER}/services/${service}`;

// The caller supplies reviewed approval/evidence, not authority inferred from
// this policy. operatorReference must be bound to the actual operator by a future
// adapter. State is consumed BEFORE a permitted request: uncertain outcomes have
// no retry path. Any rejection permanently stops this policy instance.
export function createApiEnablePolicy(approval, operatorReference, now = Date.now()) {
  closed(approval, ['schemaVersion', 'mode', 'projectId', 'projectNumber', 'approvalReference',
    'operatorReference', 'issuedAt', 'expiresAt', 'allowAlreadyEnabled', 'before']);
  need(approval.schemaVersion === 1 && approval.mode === 'APPROVED_EMAIL_TWO_API_ENABLE'
    && approval.projectId === API_PROJECT && approval.projectNumber === API_PROJECT_NUMBER, 'API_POLICY_SCOPE');
  reference(approval.approvalReference); reference(approval.operatorReference);
  need(operatorReference === approval.operatorReference, 'API_POLICY_OPERATOR');
  need(typeof approval.allowAlreadyEnabled === 'boolean', 'API_POLICY_SHAPE');
  const issued = time(approval.issuedAt), expires = time(approval.expiresAt);
  need(expires > issued && expires - issued <= WINDOW_MS, 'API_POLICY_WINDOW');
  need(Array.isArray(approval.before) && approval.before.length === 2, 'API_POLICY_SCOPE');
  const states = new Map();
  for (const [index, before] of approval.before.entries()) {
    closed(before, ['name', 'state', 'observedAt']);
    const service = API_SERVICES[index], observed = time(before.observedAt);
    need(before.name === resource(service) && before.state === 'DISABLED', 'API_POLICY_BEFORE');
    need(observed <= now && now - observed <= FRESH_MS, 'API_POLICY_STALE');
    states.set(service, {phase:'fresh', observed, operation:null, polls:0, lastPoll:0});
  }
  let stopped = false, lastNow = now;
  const allowAlreadyEnabled = approval.allowAlreadyEnabled;
  function check(at) {
    need(!stopped, 'API_POLICY_STOPPED');
    need(Number.isFinite(at) && at >= lastNow && at >= issued && at < expires, 'API_POLICY_EXPIRED');
    lastNow = at;
  }
  check(now);
  function guarded(action, at) {
    try { check(at); return action(); }
    catch (error) { stopped = true; throw error; }
  }
  function stateFor(service) {
    need(states.has(service), 'API_POLICY_SCOPE');
    return states.get(service);
  }
  function operation(value, state) {
    // A projected response contract; the future adapter must validate HTTP
    // success and map the real Operation without leaking provider error text.
    closed(value, ['name', 'done', 'failed']);
    need(typeof value.name === 'string' && /^operations\/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/u.test(value.name), 'API_POLICY_OPERATION');
    need(typeof value.done === 'boolean' && typeof value.failed === 'boolean'
      && !value.failed, 'API_POLICY_OPERATION');
    need(state.operation === null || state.operation === value.name, 'API_POLICY_OPERATION');
    need(![...states.values()].some(other => other !== state && other.operation === value.name), 'API_POLICY_OPERATION');
    state.operation = value.name;
    state.phase = value.done ? 'readback' : 'poll';
  }
  return Object.freeze({
    authorize(request, at = Date.now()) {
      return guarded(() => {
        closed(request, ['method', 'url', 'body', 'redirect']);
        need(request.redirect === 'error', 'API_POLICY_REQUEST');
        for (const [service, state] of states) {
          const url = ORIGIN + resource(service);
          if (request.method === 'GET' && request.url === url && request.body === null) {
            need(['fresh', 'readback'].includes(state.phase), 'API_POLICY_PHASE');
            const kind = state.phase === 'fresh' ? 'fresh-read' : 'enabled-readback';
            state.phase += '-pending';
            return {kind, service};
          }
          if (request.method === 'POST' && request.url === url + ':enable') {
            closed(request.body, []);
            need(state.phase === 'enable' && at - state.observed <= FRESH_MS, 'API_POLICY_PHASE');
            state.phase = 'enable-pending';
            return {kind:'api-enable', service};
          }
          if (request.method === 'GET' && state.operation !== null
            && request.url === ORIGIN + state.operation && request.body === null) {
            need(state.phase === 'poll' && state.polls < MAX_POLLS && at - state.lastPoll >= POLL_MS, 'API_POLICY_PHASE');
            state.polls++; state.lastPoll = at; state.phase = 'poll-pending';
            return {kind:'operation-read', service};
          }
        }
        throw Error('API_POLICY_REQUEST');
      }, at);
    },
    acceptService(service, evidence, at = Date.now()) {
      return guarded(() => {
        const state = stateFor(service);
        closed(evidence, ['name', 'state', 'observedAt']);
        const observed = time(evidence.observedAt);
        need(evidence.name === resource(service) && observed <= at && at - observed <= FRESH_MS
          && observed >= state.observed, 'API_POLICY_BEFORE');
        need(['fresh-pending', 'readback-pending'].includes(state.phase), 'API_POLICY_PHASE');
        if (state.phase === 'readback-pending') {
          need(evidence.state === 'ENABLED', 'API_POLICY_READBACK'); state.phase = 'complete';
        } else {
          need(evidence.state === 'DISABLED' || (evidence.state === 'ENABLED' && allowAlreadyEnabled), 'API_POLICY_DRIFT');
          state.phase = evidence.state === 'ENABLED' ? 'skipped-enabled' : 'enable';
        }
        state.observed = observed;
      }, at);
    },
    acceptOperation(service, evidence, at = Date.now()) {
      return guarded(() => {
        const state = stateFor(service);
        need(['enable-pending', 'poll-pending'].includes(state.phase), 'API_POLICY_PHASE');
        operation(evidence, state); state.lastPoll = at;
      }, at);
    },
    status(at = Date.now()) {
      return guarded(() => ({mode:'EMAIL_TWO_API_ENABLE_POLICY_ONLY',
        complete:[...states.values()].every(state => ['complete', 'skipped-enabled'].includes(state.phase)),
        services:API_SERVICES.map(service => ({service, phase:states.get(service).phase, polls:states.get(service).polls}))}), at);
    }
  });
}
