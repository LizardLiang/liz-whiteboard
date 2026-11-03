// src/lib/i18n/locales/en.ts
// English dictionary. Source of truth for the key shape: zh-TW must match it.
// Interpolation uses {name} placeholders.

export const en = {
  common: {
    appName: 'ER Whiteboard',
    loading: 'Loading...',
    email: 'Email',
    password: 'Password',
    somethingWentWrong: 'Something went wrong. Please try again.',
    backToDashboard: 'Back to dashboard',
    signIn: 'Sign in',
    readOnly: 'Read-only',
  },
  auth: {
    login: {
      subtitle: 'Sign in to your account',
      resetSuccess: 'Password updated. Log in with your new password.',
      emailPlaceholder: 'you@example.com',
      passwordPlaceholder: 'Your password',
      forgotPassword: 'Forgot password?',
      rememberMe: 'Remember me for 30 days',
      submit: 'Sign in',
      submitting: 'Signing in...',
      noAccount: "Don't have an account?",
      register: 'Register',
      emptyFields: 'Enter your email and password.',
    },
    register: {
      subtitle: 'Create your account',
      username: 'Username',
      usernamePlaceholder: 'your_username',
      passwordPlaceholder: 'At least 8 characters',
      submit: 'Create account',
      submitting: 'Creating account...',
      redirecting: 'Redirecting to login...',
      hasAccount: 'Already have an account?',
      logIn: 'Log in',
      validationFailed:
        'Validation failed. Please check your input and try again.',
    },
    forgot: {
      title: 'Forgot your password?',
      subtitle: "Enter your email and we'll send you a reset link.",
      checkEmail: 'Check your email',
      backToSignIn: 'Back to sign in',
      notConfigured:
        'Verification is not configured. Contact your administrator.',
      submit: 'Send reset link',
      submitting: 'Sending...',
      remembered: 'Remembered your password?',
      rateLimited: 'Too many requests, try again later.',
      captchaFailed: 'Verification failed. Please try again.',
    },
    reset: {
      checking: 'Checking your link...',
      linkInvalid: 'Link invalid',
      requestNew: 'Request a new link',
      title: 'Set a new password',
      newPassword: 'New password',
      confirmPassword: 'Confirm password',
      submit: 'Update password',
      submitting: 'Updating...',
    },
    sessionExpired: {
      title: 'Your session has expired',
      description:
        'You have been logged out due to inactivity. Please log in again to continue.',
      action: 'Log in again',
    },
  },
  invite: {
    title: "You've been invited",
    joinPrefix: 'Join',
    joinAs: 'as',
    checkingAccount: 'Checking your account...',
    accept: 'Accept invite',
    accepting: 'Accepting...',
    createAccount: 'Create account',
    loading: 'Loading invite...',
    unavailable: 'Invite link unavailable',
    acceptFailed: 'Something went wrong accepting this invite.',
    roles: {
      VIEWER: 'Viewer',
      EDITOR: 'Editor',
      ADMIN: 'Admin',
    },
  },
  share: {
    loadingDiagram: 'Loading diagram...',
    loadingBoard: 'Loading board...',
    unavailable: 'Shared link unavailable',
  },
  settings: {
    connections: {
      title: 'Connected applications',
      description:
        "Applications you've approved to access your ER Whiteboard account via OAuth. Revoking access here stops a client's next token refresh — an already-issued access token remains valid for up to 1 hour.",
      connectMcp: 'Connect an MCP client',
      connectMcpHint: 'Let an AI coding assistant read and edit this diagram.',
      empty: 'No connected applications yet.',
      granted: 'Granted {date}',
      revoke: 'Revoke',
      revoked: 'Access revoked',
      revokeFailed: 'Something went wrong revoking access.',
    },
  },
  consent: {
    loading: 'Loading request...',
    unavailable: 'Consent request unavailable',
    title: 'Authorize application',
    wantsAccess: 'wants to access your ER Whiteboard account.',
    notVerified:
      'This application is not verified by ER Whiteboard. Only approve it if you trust the client that sent you here.',
    identityFetched: 'Identity document fetched from',
    clientThis: 'This client',
    registeredItself: 'registered itself',
    selfAsserted: '. Its name and identity are self-asserted.',
    requestingAccess: 'Requesting access to',
    sendsBackTo: 'Sends you back to',
    loopbackPrefix: 'This will hand access to an application running on',
    loopbackEmphasis: 'your own computer',
    loopbackSuffix: '. Only approve if you just started this client yourself.',
    deny: 'Deny',
    denying: 'Denying...',
    approve: 'Approve',
    approving: 'Approving...',
    approveFailed: 'Something went wrong approving this request.',
    denyFailed: 'Something went wrong denying this request.',
  },
  email: {
    resetSubject: 'Reset your password',
    resetText:
      'Use this link to reset your password: {link}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.',
    resetHtmlIntro: 'Use this link to reset your password:',
    resetHtmlOutro:
      'This link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.',
  },
  header: {
    connections: 'Connections',
    connectedApplications: 'Connected applications',
    logout: 'Log out',
    loggingOut: 'Logging out...',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
    themeLoading: 'Theme toggle loading',
    language: 'Language',
  },
  meta: {
    title: 'ER Whiteboard - Collaborative Diagram Editor',
  },
  // Server error messages stay English on the wire. The display layer maps the
  // exact English text (the value here) to the key and shows the translation.
  errors: {
    unauthorized: 'Unauthorized',
    invalidCredentials: 'Invalid email or password',
    tooManyAttempts:
      'Too many failed attempts. Please try again in 15 minutes.',
    registrationSuccess: 'Registration successful. Please log in.',
    usernameTaken: 'Username is already taken',
    resetRequested:
      'If an account exists for that email, a reset link is on its way.',
    linkInvalidOrExpired: 'This link is invalid or has expired.',
    passwordMin: 'Password must be at least 8 characters',
    passwordMax: 'Password must be at most 128 characters',
    usernameMin: 'Username must be at least 3 characters',
    usernameMax: 'Username must be at most 50 characters',
    usernameFormat: 'Username must be alphanumeric with underscores only',
    invalidEmail: 'Invalid email address',
    emailMax: 'Email must be at most 255 characters',
    passwordRequired: 'Password is required',
    verificationRequired: 'Verification is required',
    missingResetToken: 'Missing reset token',
    confirmPasswordRequired: 'Please confirm your password',
    passwordsMismatch: 'Passwords do not match',
    consentExpired:
      'This consent request has expired or is invalid. Please try connecting again from your client.',
    inviteInvalid: 'This invite link is invalid.',
    inviteRevoked: 'This invite link has been revoked.',
    inviteExpired: 'This invite link has expired.',
    inviteExhausted: 'This invite link has already been used.',
    inviteNoLongerValid: 'This invite link is no longer valid.',
    shareInvalid: 'This shared link is invalid.',
    shareRevoked: 'This shared link has been revoked.',
    shareExpired: 'This shared link has expired.',
    shareNoLongerValid: 'This shared link is no longer valid.',
    sessionExpired: 'Your session expired. Please sign in again.',
  },
} as const

export type Dictionary = typeof en

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`
}[keyof T & string]

export type TranslationKey = Paths<Dictionary>

export type DeepStringRecord<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]>
}
