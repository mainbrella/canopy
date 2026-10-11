import { createAuthClient, GOOGLE_CLIENT_ID, API_ORIGIN } from './auth.ts';
import { createLedgerView } from './ledger.ts';
import { createAcquisitionView } from './acquisition.ts';
import { createEmailView } from './email.ts';
import { createEmailAllView } from './email-all.ts';
import { createUserDetailView } from './user-detail.ts';
import { isAdminUser, type AdminUser, type User } from './types.ts';

const auth = createAuthClient();
function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required page element not found: ${selector}`);
  return element;
}

const page = requiredElement<HTMLElement>('.login-content');
const status = requiredElement<HTMLElement>('.login-status');
const error = requiredElement<HTMLElement>('.login-error');
const provider = requiredElement<HTMLElement>('.login-provider');
const googleHost = requiredElement<HTMLElement>('.google-button-host');
const googleLoading = requiredElement<HTMLElement>('.google-loading');
const googleRetry = requiredElement<HTMLButtonElement>('.google-retry');
const account = requiredElement<HTMLElement>('.account');
const identity = requiredElement<HTMLElement>('.login-identity');
const signOutButton = requiredElement<HTMLButtonElement>('.login-sign-out');
const loginTitle = requiredElement<HTMLHeadingElement>('#login-title');
const usersTitle = requiredElement<HTMLHeadingElement>('#users-title');
const emailForm = requiredElement<HTMLFormElement>('.email-login-form');
const emailInput = requiredElement<HTMLInputElement>('#login-email');
const passwordInput = requiredElement<HTMLInputElement>('#login-password');
const emailSubmit = requiredElement<HTMLButtonElement>('.email-login-submit');
const usersPage = requiredElement<HTMLElement>('.users-content');
const usersStatus = requiredElement<HTMLElement>('.users-status');
const usersError = requiredElement<HTMLElement>('.users-error');
const usersTable = requiredElement<HTMLElement>('.users-table-wrap');
const usersRows = requiredElement<HTMLTableSectionElement>('.users-rows');
const usersRefresh = requiredElement<HTMLButtonElement>('.users-refresh');
const userDetailPage = requiredElement<HTMLElement>('.user-detail-content');
const userDetailTitle = requiredElement<HTMLHeadingElement>('#user-detail-title');
const userDetailStatus = requiredElement<HTMLElement>('.user-detail-status');
const userDetailError = requiredElement<HTMLElement>('.user-detail-error');
const adminNav = requiredElement<HTMLElement>('.admin-nav');
const appShell = requiredElement<HTMLElement>('.app-shell');
const ledgerPage = requiredElement<HTMLElement>('.ledger-content');
const ledgerTitle = requiredElement<HTMLHeadingElement>('#ledger-title');
const ledgerStatus = requiredElement<HTMLElement>('.ledger-status');
const ledgerError = requiredElement<HTMLElement>('.ledger-error');
const ledgerTable = requiredElement<HTMLElement>('.ledger-table-wrap');
const ledgerRows = requiredElement<HTMLTableSectionElement>('.ledger-rows');
const ledgerRefresh = requiredElement<HTMLButtonElement>('.ledger-refresh');
const ledgerPrevious = requiredElement<HTMLButtonElement>('.ledger-previous');
const ledgerNext = requiredElement<HTMLButtonElement>('.ledger-next');
const ledgerPagination = requiredElement<HTMLElement>('.ledger-pagination');
const acquisitionPage = requiredElement<HTMLElement>('.acquisition-content');
const acquisitionTitle = requiredElement<HTMLHeadingElement>('#acquisition-title');
const acquisitionStatus = requiredElement<HTMLElement>('.acquisition-status');
const acquisitionError = requiredElement<HTMLElement>('.acquisition-error');
const emailPage = requiredElement<HTMLElement>('.email-content');
const emailTitle = requiredElement<HTMLHeadingElement>('#email-title');
const emailStatus = requiredElement<HTMLElement>('.email-status');
const emailError = requiredElement<HTMLElement>('.email-error');
const emailAllPage = requiredElement<HTMLElement>('.email-all-content');
const emailAllTitle = requiredElement<HTMLHeadingElement>('#email-all-title');
const emailAllStatus = requiredElement<HTMLElement>('.email-all-status');
const emailAllError = requiredElement<HTMLElement>('.email-all-error');
const ADMIN_EMAIL = 'oneone@gmail.com';
const signInPrompt = 'Continue with Google or email and password.';

let user: User | null = null;
let signingIn = false;
let signingOut = false;
let usersRequest = 0;
const userDetail = createUserDetailView({
  page: userDetailPage, status: userDetailStatus, error: userDetailError,
  content: requiredElement<HTMLElement>('.user-detail-data'),
  name: requiredElement<HTMLElement>('.user-detail-name'),
  email: requiredElement<HTMLElement>('.user-detail-email'),
  plan: requiredElement<HTMLElement>('.user-detail-plan'),
  created: requiredElement<HTMLElement>('.user-detail-created'),
  id: requiredElement<HTMLElement>('.user-detail-id'),
  balance: requiredElement<HTMLElement>('.user-detail-balance'),
  available: requiredElement<HTMLElement>('.user-detail-available'),
  reserved: requiredElement<HTMLElement>('.user-detail-reserved'),
  fundingStatus: requiredElement<HTMLElement>('.funding-status'),
  table: requiredElement<HTMLElement>('.funding-table-wrap'),
  rows: requiredElement<HTMLTableSectionElement>('.funding-rows'),
  refresh: requiredElement<HTMLButtonElement>('.user-detail-refresh'),
  previous: requiredElement<HTMLButtonElement>('.funding-previous'),
  next: requiredElement<HTMLButtonElement>('.funding-next'),
  pagination: requiredElement<HTMLElement>('.funding-pagination'),
}, () => isAdmin() && !signingOut, handleAdminAuthFailure);
const ledger = createLedgerView({
  page: ledgerPage, status: ledgerStatus, error: ledgerError, table: ledgerTable, rows: ledgerRows,
  refresh: ledgerRefresh, previous: ledgerPrevious, next: ledgerNext, pagination: ledgerPagination,
}, () => isAdmin() && !signingOut, handleAdminAuthFailure);
const acquisition = createAcquisitionView({
  page: acquisitionPage, status: acquisitionStatus, error: acquisitionError,
  table: requiredElement<HTMLElement>('.acquisition-table-wrap'),
  columns: requiredElement<HTMLTableRowElement>('.acquisition-columns'),
  rows: requiredElement<HTMLTableSectionElement>('.acquisition-rows'),
  refresh: requiredElement<HTMLButtonElement>('.acquisition-refresh'),
  previous: requiredElement<HTMLButtonElement>('.acquisition-previous'),
  next: requiredElement<HTMLButtonElement>('.acquisition-next'),
  pagination: requiredElement<HTMLElement>('.acquisition-pagination'),
  views: requiredElement<HTMLElement>('.acquisition-views'),
  filters: requiredElement<HTMLFormElement>('.acquisition-filters'),
  eventFilter: requiredElement<HTMLElement>('.acquisition-event-filter'),
}, () => isAdmin() && !signingOut, handleAdminAuthFailure);

const email = createEmailView({
  form: requiredElement<HTMLFormElement>('.email-send-form'),
  fields: requiredElement<HTMLFieldSetElement>('.email-fields'),
  from: requiredElement<HTMLInputElement>('#email-from'),
  to: requiredElement<HTMLInputElement>('#email-to'),
  subj: requiredElement<HTMLInputElement>('#email-subj'),
  message: requiredElement<HTMLTextAreaElement>('#email-message'),
  submit: requiredElement<HTMLButtonElement>('.email-send-submit'),
  status: emailStatus, error: emailError,
}, () => isAdmin() && !signingOut, handleAdminAuthFailure);
const emailAll = createEmailAllView({
  page: emailAllPage,
  form: requiredElement<HTMLFormElement>('.email-all-send-form'),
  fields: requiredElement<HTMLFieldSetElement>('.email-all-fields'),
  from: requiredElement<HTMLInputElement>('#email-all-from'),
  subj: requiredElement<HTMLInputElement>('#email-all-subj'),
  message: requiredElement<HTMLTextAreaElement>('#email-all-message'),
  submit: requiredElement<HTMLButtonElement>('.email-all-send-submit'),
  sendStatus: requiredElement<HTMLElement>('.email-all-send-status'),
  status: emailAllStatus,
  error: emailAllError,
  list: requiredElement<HTMLUListElement>('.email-all-list'),
  refresh: requiredElement<HTMLButtonElement>('.email-all-refresh'),
}, () => isAdmin() && !signingOut, handleAdminAuthFailure);

function currentAdminRoute() {
  const path = location.pathname.replace(/\/$/, '');
  return path === '/users/detail' ? 'user-detail' : path === '/email-all' ? 'email-all' : path === '/email' ? 'email' : path === '/acquisition' ? 'acquisition' : path === '/ledger' ? 'ledger' : 'users';
}

function isAdmin() {
  return user?.email?.trim().toLowerCase() === ADMIN_EMAIL;
}

function isAdminUsersResponse(value: unknown): value is { users: AdminUser[] } {
  return typeof value === 'object' && value !== null && 'users' in value
    && Array.isArray(value.users) && value.users.every(isAdminUser);
}

start();

async function start() {
  page.setAttribute('aria-busy', 'true');
  status.textContent = 'Checking your session…';
  try {
    const session = await auth.readSession();
    user = session?.user || null;
    await showCurrentState();
  } catch (cause) {
    showError(cause);
    provider.hidden = false;
    status.textContent = 'Could not check your session.';
    loadGoogleButton();
  } finally {
    page.setAttribute('aria-busy', 'false');
  }
}

async function showCurrentState() {
  usersRequest++;
  userDetail.setUser(null);
  ledger.setActive(false);
  acquisition.setActive(false);
  email.setActive(false);
  emailAll.setActive(false);
  emailAll.clear();
  adminNav.hidden = true;
  appShell.classList.remove('is-admin');
  for (const link of adminNav.querySelectorAll<HTMLAnchorElement>('a[data-admin-route]')) link.removeAttribute('aria-current');
  usersRows.replaceChildren();
  usersTable.hidden = true;
  usersError.hidden = true;
  usersPage.hidden = true;
  userDetailPage.hidden = true;
  ledgerPage.hidden = true;
  acquisitionPage.hidden = true;
  emailPage.hidden = true;
  emailAllPage.hidden = true;
  page.hidden = false;
  loginTitle.textContent = 'Log in';
  clearError();
  account.hidden = !user;
  identity.textContent = user?.email || '';
  provider.hidden = Boolean(user);
  if (isAdmin()) {
    page.hidden = true;
    adminNav.hidden = false;
    appShell.classList.add('is-admin');
    showAdminRoute();
  } else if (user) {
    showAccessDenied();
  } else {
    status.textContent = signInPrompt;
    loadGoogleButton();
  }
}

function showAccessDenied() {
  userDetail.setUser(null);
  ledger.setActive(false);
  acquisition.setActive(false);
  email.setActive(false);
  emailAll.setActive(false);
  email.clear();
  emailAll.clear();
  adminNav.hidden = true;
  appShell.classList.remove('is-admin');
  usersPage.hidden = true;
  userDetailPage.hidden = true;
  ledgerPage.hidden = true;
  acquisitionPage.hidden = true;
  emailPage.hidden = true;
  emailAllPage.hidden = true;
  usersRows.replaceChildren();
  usersTable.hidden = true;
  page.hidden = false;
  page.setAttribute('aria-busy', 'false');
  provider.hidden = true;
  loginTitle.textContent = 'Access denied';
  status.textContent = `Admin access is limited to ${ADMIN_EMAIL}. Sign out to use that account.`;
}

function showAdminRoute() {
  if (!isAdmin() || signingOut) return;
  const route = currentAdminRoute();
  const canonicalPath = route === 'user-detail' ? '/users/detail' : `/${route}`;
  const hash = location.hash === '#main' ? location.hash : '';
  if (location.pathname !== canonicalPath || location.hash !== hash) {
    history.replaceState(null, '', `${canonicalPath}${location.search}${hash}`);
  }
  for (const link of adminNav.querySelectorAll<HTMLAnchorElement>('a[data-admin-route]')) {
    if (link.dataset.adminRoute === (route === 'user-detail' ? 'users' : route)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  usersPage.hidden = route !== 'users';
  userDetailPage.hidden = route !== 'user-detail';
  ledgerPage.hidden = route !== 'ledger';
  acquisitionPage.hidden = route !== 'acquisition';
  emailPage.hidden = route !== 'email';
  emailAllPage.hidden = route !== 'email-all';
  ledger.setActive(route === 'ledger');
  acquisition.setActive(route === 'acquisition');
  email.setActive(route === 'email');
  emailAll.setActive(route === 'email-all');
  userDetail.setUser(route === 'user-detail' ? new URLSearchParams(location.search).get('id') ?? '' : null);
  if (route === 'users') {
    usersTitle.focus({ preventScroll: true });
    void loadUsers();
  } else {
    usersRequest++;
    (route === 'user-detail' ? userDetailTitle : route === 'email-all' ? emailAllTitle : route === 'email' ? emailTitle : route === 'ledger' ? ledgerTitle : acquisitionTitle).focus({ preventScroll: true });
  }
}

function handleAdminAuthFailure(responseStatus: 401 | 403) {
  if (responseStatus === 401) {
    user = null;
    void showCurrentState().then(() => { status.textContent = 'Your session expired. Sign in again.'; });
  } else {
    showAccessDenied();
  }
}

document.addEventListener('click', (event) => {
  if (!(event instanceof MouseEvent) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-admin-route]') : null;
  if (!target || target.origin !== location.origin || target.target || target.hasAttribute('download')) return;
  const route = target.dataset.adminRoute;
  if (route !== 'users' && route !== 'user-detail' && route !== 'ledger' && route !== 'acquisition' && route !== 'email' && route !== 'email-all') return;
  event.preventDefault();
  const nextPath = route === 'user-detail' ? '/users/detail' : `/${route}`;
  const currentRoute = currentAdminRoute();
  const nextSearch = route === 'user-detail' ? target.search : currentRoute === 'user-detail' ? '' : location.search;
  if (route === currentRoute && location.pathname === nextPath && location.search === nextSearch) return;
  history.pushState(null, '', `${nextPath}${nextSearch}`);
  if (isAdmin()) showAdminRoute();
});

window.addEventListener('popstate', () => {
  if (isAdmin()) showAdminRoute();
});

async function loadUsers() {
  if (!isAdmin() || signingOut) return;
  const requestID = ++usersRequest;
  usersRefresh.disabled = true;
  usersPage.setAttribute('aria-busy', 'true');
  usersStatus.textContent = 'Loading users…';
  usersError.hidden = true;
  usersRows.replaceChildren();
  usersTable.hidden = true;
  try {
    const response = await fetch(`${API_ORIGIN}/admin/users`, {
      credentials: 'include', headers: { accept: 'application/json' },
    });
    if (requestID !== usersRequest) return;
    if (response.status === 401) {
      user = null;
      await showCurrentState();
      status.textContent = 'Your session expired. Sign in again.';
      return;
    }
    if (response.status === 403) {
      showAccessDenied();
      return;
    }
    const result: unknown = await response.json().catch(() => null);
    if (requestID !== usersRequest) return;
    if (!response.ok || !isAdminUsersResponse(result)) throw new Error('users_unavailable');
    const rows = document.createDocumentFragment();
    for (const item of result.users) {
      const row = document.createElement('tr');
      row.className = 'user-row';
      const created = new Date(item.created_at);
      const values = [item.name || '—', item.email || '—', item.plan[0].toUpperCase() + item.plan.slice(1),
        Number.isFinite(created.getTime()) ? created.toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        }) : item.created_at || '—', item.id];
      for (const [index, value] of values.entries()) {
        const cell = document.createElement('td');
        if (index === 0) {
          const link = document.createElement('a');
          link.className = 'user-link';
          link.href = `/users/detail?${new URLSearchParams({ id: item.id })}`;
          link.dataset.adminRoute = 'user-detail';
          link.textContent = item.name || item.email || item.id;
          link.setAttribute('aria-label', `View user ${item.name || item.email || item.id}`);
          cell.append(link);
        } else if (index === 3 && Number.isFinite(created.getTime())) {
          const time = document.createElement('time');
          time.dateTime = item.created_at;
          time.title = item.created_at;
          time.textContent = value;
          cell.append(time);
        } else cell.textContent = value;
        row.append(cell);
      }
      rows.append(row);
    }
    usersRows.replaceChildren(rows);
    usersTable.hidden = result.users.length === 0;
    usersStatus.textContent = result.users.length
      ? `${result.users.length.toLocaleString()} ${result.users.length === 1 ? 'user' : 'users'} · Newest first`
      : 'No users found.';
  } catch {
    if (requestID !== usersRequest) return;
    usersStatus.textContent = 'Could not load users.';
    usersError.textContent = 'Check your connection and use Refresh to try again.';
    usersError.hidden = false;
  } finally {
    if (requestID === usersRequest) {
      usersRefresh.disabled = false;
      usersPage.setAttribute('aria-busy', 'false');
    }
  }
}

usersRefresh.addEventListener('click', () => loadUsers());

async function loadGoogleButton() {
  googleHost.replaceChildren();
  googleRetry.hidden = true;
  googleLoading.hidden = false;
  googleLoading.textContent = 'Loading Google sign-in…';
  googleHost.setAttribute('aria-busy', 'true');
  try {
    await loadGoogleIdentityScript();
    if (provider.hidden) return;
    if (!window.google?.accounts?.id) throw new Error('Google sign-in is unavailable. Please retry.');
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleCredential(response?.credential),
      context: 'signin',
      ux_mode: 'popup',
    });
    window.google.accounts.id.renderButton(googleHost, {
      type: 'standard',
      theme: 'outline_dark',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.min(360, googleHost.clientWidth || 360),
    });
    googleLoading.hidden = true;
  } catch {
    googleLoading.hidden = false;
    googleRetry.hidden = false;
    googleLoading.textContent = 'Google sign-in could not load. You can use email below or retry Google.';
  } finally {
    googleHost.setAttribute('aria-busy', 'false');
  }
}

async function handleCredential(credential: string | undefined): Promise<void> {
  await signIn(() => auth.signInWithGoogle(credential));
}

emailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!emailForm.reportValidity()) return;
  if (emailInput.value.trim().toLowerCase() !== ADMIN_EMAIL) {
    showError(new Error(`Admin access is limited to ${ADMIN_EMAIL}.`));
    return;
  }
  await signIn(() => auth.signInWithEmail(emailInput.value, passwordInput.value));
});

async function signIn(authenticate: () => Promise<{ user: User }>): Promise<void> {
  if (signingIn || signingOut || user) return;
  signingIn = true;
  clearError();
  status.textContent = 'Signing in…';
  page.setAttribute('aria-busy', 'true');
  provider.classList.add('is-disabled');
  for (const control of [emailInput, passwordInput, emailSubmit]) {
    if (control) control.disabled = true;
  }
  if (emailSubmit) emailSubmit.textContent = 'Continuing…';
  try {
    const session = await authenticate();
    user = session.user;
    if (passwordInput) passwordInput.value = '';
    await showCurrentState();
  } catch (cause) {
    status.textContent = signInPrompt;
    showError(cause);
  } finally {
    signingIn = false;
    page.setAttribute('aria-busy', 'false');
    provider.classList.remove('is-disabled');
    for (const control of [emailInput, passwordInput, emailSubmit]) {
      if (control) control.disabled = false;
    }
    if (emailSubmit) emailSubmit.textContent = 'Continue with email';
  }
}

signOutButton.addEventListener('click', async () => {
  if (signingOut || signingIn || !user) return;
  signingOut = true;
  usersRequest++;
  userDetail.setUser(null);
  ledger.setActive(false);
  acquisition.setActive(false);
  email.setActive(false);
  emailAll.setActive(false);
  signOutButton.disabled = true;
  page.setAttribute('aria-busy', 'true');
  const currentStatus = page.hidden ? usersStatus : status;
  const currentPageStatus = !userDetailPage.hidden ? userDetailStatus : !emailAllPage.hidden ? emailAllStatus : !emailPage.hidden ? emailStatus : !acquisitionPage.hidden ? acquisitionStatus : ledgerPage.hidden ? currentStatus : ledgerStatus;
  currentPageStatus.textContent = 'Signing out…';
  clearError();
  let restoreAdminRoute = false;
  let signOutError: unknown;
  try {
    await auth.signOut();
    email.clear();
    emailAll.clear();
    user = null;
    await showCurrentState();
    emailInput.focus();
  } catch (cause) {
    signOutError = cause;
    currentPageStatus.textContent = 'You’re still signed in.';
    showError(cause);
    restoreAdminRoute = true;
  } finally {
    signingOut = false;
    signOutButton.disabled = false;
    page.setAttribute('aria-busy', 'false');
    if (restoreAdminRoute) {
      showAdminRoute();
      showError(signOutError);
    }
  }
});

googleRetry.addEventListener('click', () => {
  clearError();
  loadGoogleButton();
});

window.addEventListener('auth-change', (event) => {
  if (event.detail?.user !== null || !user || signingOut) return;
  email.clear();
  emailAll.clear();
  user = null;
  showCurrentState();
});

function showError(cause: unknown) {
  const target = page.hidden ? (!userDetailPage.hidden ? userDetailError : !emailAllPage.hidden ? emailAllError : !emailPage.hidden ? emailError : !acquisitionPage.hidden ? acquisitionError : ledgerPage.hidden ? usersError : ledgerError) : error;
  target.textContent = cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
  target.hidden = false;
}

function clearError() {
  error.textContent = '';
  error.hidden = true;
  usersError.textContent = '';
  usersError.hidden = true;
  userDetailError.textContent = '';
  userDetailError.hidden = true;
  ledgerError.textContent = '';
  ledgerError.hidden = true;
  acquisitionError.textContent = '';
  acquisitionError.hidden = true;
  emailError.textContent = '';
  emailError.hidden = true;
  emailAllError.textContent = '';
  emailAllError.hidden = true;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
  const script = existingScript || document.createElement('script');
  if (!existingScript) {
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
  }

  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (failure?: Error) => {
      clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (failure) {
        script.remove();
        reject(failure);
      } else resolve();
    };
    const onLoad = () => finish();
    const onError = () => finish(new Error('Google sign-in could not load.'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    timeout = setTimeout(() => finish(new Error('Google sign-in took too long to load.')), 12000);
    if (!existingScript) document.head.appendChild(script);
  });
}
