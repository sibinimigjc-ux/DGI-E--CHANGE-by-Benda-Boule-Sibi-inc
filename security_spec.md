# DGI E-Echange Security Specification

## 1. Data Invariants
- An `Exchange` must have a valid `senderId` and `receiverId`.
- A `contributor` can only view/create exchanges where they are the `senderId`.
- An `agent` or `admin` can view all exchanges and internal messages.
- `InternalMessage` is strictly for agent-to-agent communication.
- `AppUser` profile is mandatory for all users; roles are `contributor`, `agent`, or `admin`.
- Configuration (`config/studio`) is public for reading but only the super-admin can write.

## 2. Global Helpers
- `isSignedIn()`: Basic auth check.
- `isOwner(uid)`: `request.auth.uid == uid`.
- `isValidId(id)`: String check + size + regex.
- `isAgent()`: checks if user document has `role` as 'agent' or 'admin'.
- `isAdmin()`: checks if user document has `role` as 'admin'.

## 3. The "Dirty Dozen" Payloads (Red Team Test Cases)
1. **Identity Spoofing**: Contributor attempts to create a message with `senderId` of another user.
2. **Role Escalation**: Anonymous user attempts to set their role to `admin` during profile creation.
3. **Ghost Update**: Agent attempts to change the `senderId` of an existing message.
4. **Logic Shortcut**: Contributor attempts to read `/internal_messages`.
5. **Config Poisoning**: Contributor attempts to overwrite the DGI branding.
6. **Query Scraping**: Signed-in user attempts to list all users without being an admin.
7. **Resource Exhaustion**: Malicious user attempts to create a document with 1MB ID string.
8. **PII Leak**: Contributor attempts to `get` another user's profile containing NIU (Tax Number).
9. **State Locking Bypass**: User attempts to change `createdAt` on an existing exchange.
10. **Impersonation**: User sets `displayName` in an exchange to "DGI Official" while `senderId` is their own.
11. **Malicious Payload**: User sends an exchange with a 1MB `subject` string.
12. **Orphaned Message**: User creates an exchange with a `receiverId` that doesn't exist (verified via `exists`).

## 4. Remediation Plan
- Fix `configs` vs `config` collection name discrepancy.
- Move `getUserData` logic into specific helpers to avoid recursive calls.
- Enforce strict size and type validation on all writes.
- Secure List queries for `exchanges` by checking `resource.data.senderId`.
- Protect `users` collection from blanket reads.
