# Firebase Emulator Notes

## Firestore rule snippets

```rules
match /arenas/{arenaId}/state/{stateId} {
  function hasMatchingWriterUid() {
    return (request.resource != null && request.resource.data.writerUid == request.auth.uid)
      || (resource != null && resource.data.writerUid == request.auth.uid);
  }

  allow read: if isSignedIn();
  allow write: if isSignedIn()
    && (stateId != "current" || hasMatchingWriterUid());
}
```

`state/current` can only be created, updated, or deleted by the user whose UID matches the `writerUid` field on the incoming data (or the document's stored writer). Other arena state documents remain writable by any authenticated client.

```rules
match /arenas/{arenaId} {
  match /inputs/{docId} {
    allow read: if isSignedIn();
    allow create, update: if isSignedIn()
      && request.resource.data.authUid == request.auth.uid;
    allow delete: if isSignedIn()
      && resource != null
      && resource.data.authUid == request.auth.uid;
  }

  match /presence/{playerId} {
    function hasMatchingAuthUid() {
      return request.resource != null
        && request.resource.data.authUid == request.auth.uid;
    }

    function hasValidTimestamps() {
      return request.resource != null
        && request.resource.data.lastSeen is timestamp
        && request.resource.data.expireAt is timestamp
        && request.resource.data.lastSeen >= request.time - duration.value(5, "minutes")
        && request.resource.data.lastSeen <= request.time
        && request.resource.data.expireAt >= request.time
        && request.resource.data.expireAt <= request.time + duration.value(10, "minutes");
    }

    allow read: if isSignedIn();
    allow create, update: if isSignedIn() && hasMatchingAuthUid() && hasValidTimestamps();
    allow delete: if isSignedIn()
      && resource != null
      && resource.data.authUid == request.auth.uid;
  }
}
```

Inputs, presence, and state reads continue to work for anonymous-authenticated sessions, but each input document stays owner-writable only.
