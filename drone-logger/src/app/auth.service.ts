import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE, USE_MOCK } from './api.config';

interface Me {
  signedIn: boolean;
  /** Listed in the API's Auth__OwnerIds: can make changes and see visitor stats. */
  owner: boolean;
  /** The account's id, only sent when signed in but not an owner, so it can be added to Auth__OwnerIds. */
  id?: string | null;
  name: string;
  /** False when running locally, where there's no App Service sign-in to leave. */
  canSignOut: boolean;
}

/**
 * Who's looking. Visitors can browse everything; only GitDrone's owners get edit controls (signing in with any other
 * account changes nothing). The API enforces the same rule, so hiding buttons here is a courtesy, not the protection.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private me = signal<Me | null>(null);
  private loading: Promise<Me> | null = null;

  readonly signedIn = computed(() => this.me()?.signedIn ?? false);
  readonly canEdit = computed(() => this.me()?.owner ?? false);
  /** Set when signed in with an account that isn't an owner. */
  readonly accountId = computed(() => this.me()?.id ?? null);
  readonly name = computed(() => this.me()?.name ?? '');
  readonly canSignOut = computed(() => this.me()?.canSignOut ?? false);

  constructor() {
    this.load();
  }

  load(): Promise<Me> {
    this.loading ??= USE_MOCK
      ? Promise.resolve({ signedIn: true, owner: true, name: 'Mock', canSignOut: false })
      : firstValueFrom(this.http.get<Me>(`${API_BASE}/me`)).catch(() => ({ signedIn: false, owner: false, name: '', canSignOut: false }));
    return this.loading.then(m => { this.me.set(m); return m; });
  }

  /** App Service Authentication's login, coming back to the current page afterwards. */
  signInUrl(returnTo = location.pathname + location.search) {
    return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
  }

  readonly signOutUrl = '/.auth/logout?post_logout_redirect_uri=/';
}

/**
 * For owner-only pages (forms, imports, uploads, stats): visitors are sent to sign in; someone signed in with an account
 * that isn't an owner goes back to the home page, since signing in again wouldn't help.
 */
export const requireSignIn: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const me = await auth.load();
  if (me.owner) return true;
  if (me.signedIn) return inject(Router).parseUrl('/');
  if (me.canSignOut || !location.hostname.startsWith('localhost')) {
    location.href = auth.signInUrl(state.url);
    return false;
  }
  return inject(Router).parseUrl('/');
};
