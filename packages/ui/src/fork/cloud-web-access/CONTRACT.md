# Desktop Self-hosted Relay Setup Contract

The setup form owns only unsaved endpoint, username and password drafts. It submits through `IPlatformService`; Desktop Main validates and persists the configuration. The form never writes credentials to localStorage, settings or another Renderer cache.
