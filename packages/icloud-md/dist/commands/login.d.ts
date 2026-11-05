/**
 * Login is a headed browser window where Apple's own pages run the entire
 * sign-in flow (any 2FA variant, CAPTCHAs, whatever they ship next), after
 * which we capture the session cookies and immediately verify them against
 * /validate - so a successful `login` is also proof the session works.
 */
export declare function runLogin(sessionPath?: string): Promise<void>;
