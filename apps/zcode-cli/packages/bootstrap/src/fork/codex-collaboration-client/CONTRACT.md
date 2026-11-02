# Canonical collaboration read model

Owns read-only root resolution and validation. Runtime controller remains the
single mutable owner. Walk only real subagent_child parent edges, checking the
accepted graph; ordinary fork ancestry does not inherit a collaboration tree.
The graph recovers accepted-before-tool-result gaps. Private state.metadata
relations are strict derived facts, compared against canonical identity.

Exact live controller status is an injected synchronous reader; an unowned saved
running child is rendered cancelled without persisting or scheduling a transition.
Queries never instantiate a controller, parse ACK text or fabricate session IDs.
ProductProjection is the sole lifecycle row owner and receives these seed facts.
