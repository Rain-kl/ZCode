# Desktop Self-hosted Relay Contract

Desktop Main owns Relay configuration, authentication and the existing Web Remote Control manager lifecycle. Renderer submits an endpoint, username and password once through the typed Platform boundary. Main validates the self-hosted login contract, stores only non-secret metadata in settings and stores the session token through the credential service. Passwords and session tokens never become Renderer persistence.

The existing Desktop manager remains the only device transport and shared-host attachment owner. A self-hosted configuration changes its endpoint and login source; it does not create another connector, Host, task runtime, queue or snapshot owner.
