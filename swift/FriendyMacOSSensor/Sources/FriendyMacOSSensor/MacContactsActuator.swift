import Foundation

#if os(macOS) && canImport(Contacts)
import Contacts

enum MacContactsAction: String, Decodable {
    case READ
    case CREATE
    case UPDATE
    case DELETE
}

struct MacContactsCommand: Decodable {
    let action: MacContactsAction
    let id: String?
    let query: String?
    let fields: MacContactFields?
    let patch: MacContactFields?
}

struct MacContactFields: Decodable {
    let givenName: String?
    let familyName: String?
    let middleName: String?
    let nickname: String?
    let organizationName: String?
    let departmentName: String?
    let jobTitle: String?
    let note: String?
    let phoneNumbers: [MacLabeledString]?
    let emailAddresses: [MacLabeledString]?
    let postalAddresses: [MacPostalAddressInput]?
}

struct MacLabeledString: Decodable {
    let label: String?
    let value: String
}

struct MacPostalAddressInput: Decodable {
    let label: String?
    let street: String?
    let city: String?
    let state: String?
    let postalCode: String?
    let country: String?
}

enum MacContactsActuatorError: Error {
    case missingStdin
    case missingContactId
    case missingFields
    case contactNotFound(String)
    case permissionDenied
}

func runMacContactsActuatorFromStandardInput() {
    do {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        guard !input.isEmpty else {
            throw MacContactsActuatorError.missingStdin
        }

        let command = try JSONDecoder().decode(MacContactsCommand.self, from: input)
        let result = try runMacContactsActuator(command: command)
        emitMacContactsActuatorJson(result)
    } catch {
        emitMacContactsActuatorJson([
            "ok": false,
            "error": String(describing: error)
        ])
        exit(1)
    }
}

func runMacContactsActuator(command: MacContactsCommand) throws -> [String: Any] {
    let store = CNContactStore()
    try ensureContactsAccess(store: store)

    switch command.action {
    case .READ:
        let contacts = try readContacts(store: store, id: command.id, query: command.query)
        return [
            "ok": true,
            "contacts": contacts.map(serializeContact)
        ]
    case .CREATE:
        guard let fields = command.fields else {
            throw MacContactsActuatorError.missingFields
        }
        let contact = CNMutableContact()
        applyContactFields(fields, to: contact)
        let saveRequest = CNSaveRequest()
        saveRequest.add(contact, toContainerWithIdentifier: nil)
        try store.execute(saveRequest)
        return [
            "ok": true,
            "identifier": contact.identifier
        ]
    case .UPDATE:
        guard let id = command.id else {
            throw MacContactsActuatorError.missingContactId
        }
        guard let patch = command.patch ?? command.fields else {
            throw MacContactsActuatorError.missingFields
        }
        let existing = try fetchContactById(store: store, id: id)
        let mutable = existing.mutableCopy() as! CNMutableContact
        applyContactFields(patch, to: mutable)
        let saveRequest = CNSaveRequest()
        saveRequest.update(mutable)
        try store.execute(saveRequest)
        return [
            "ok": true,
            "identifier": mutable.identifier
        ]
    case .DELETE:
        guard let id = command.id else {
            throw MacContactsActuatorError.missingContactId
        }
        let existing = try fetchContactById(store: store, id: id)
        let mutable = existing.mutableCopy() as! CNMutableContact
        let saveRequest = CNSaveRequest()
        saveRequest.delete(mutable)
        try store.execute(saveRequest)
        return [
            "ok": true,
            "identifier": id,
            "deleted": true
        ]
    }
}

func ensureContactsAccess(store: CNContactStore) throws {
    let status = CNContactStore.authorizationStatus(for: .contacts)
    if status == .authorized {
        return
    }

    if status == .notDetermined {
        prepareForSystemPermissionPrompt()
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        var requestError: Error?
        store.requestAccess(for: .contacts) { didGrant, error in
            granted = didGrant
            requestError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let requestError {
            throw requestError
        }
        if granted {
            return
        }
    }

    throw MacContactsActuatorError.permissionDenied
}

func readContacts(store: CNContactStore, id: String?, query: String?) throws -> [CNContact] {
    if let id, !id.isEmpty {
        return [try fetchContactById(store: store, id: id)]
    }

    let request = CNContactFetchRequest(keysToFetch: contactKeysToFetch())
    request.sortOrder = .userDefault
    var contacts: [CNContact] = []
    let normalizedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""

    try store.enumerateContacts(with: request) { contact, _ in
        if normalizedQuery.isEmpty || contactMatchesQuery(contact, normalizedQuery) {
            contacts.append(contact)
        }
    }

    return contacts
}

func fetchContactById(store: CNContactStore, id: String) throws -> CNContact {
    do {
        return try store.unifiedContact(withIdentifier: id, keysToFetch: contactKeysToFetch())
    } catch {
        throw MacContactsActuatorError.contactNotFound(id)
    }
}

func contactKeysToFetch() -> [CNKeyDescriptor] {
    return [
        CNContactIdentifierKey as CNKeyDescriptor,
        CNContactGivenNameKey as CNKeyDescriptor,
        CNContactMiddleNameKey as CNKeyDescriptor,
        CNContactFamilyNameKey as CNKeyDescriptor,
        CNContactNicknameKey as CNKeyDescriptor,
        CNContactOrganizationNameKey as CNKeyDescriptor,
        CNContactDepartmentNameKey as CNKeyDescriptor,
        CNContactJobTitleKey as CNKeyDescriptor,
        CNContactPhoneNumbersKey as CNKeyDescriptor,
        CNContactEmailAddressesKey as CNKeyDescriptor,
        CNContactPostalAddressesKey as CNKeyDescriptor,
        CNContactNoteKey as CNKeyDescriptor
    ]
}

func applyContactFields(_ fields: MacContactFields, to contact: CNMutableContact) {
    if let givenName = fields.givenName { contact.givenName = givenName }
    if let familyName = fields.familyName { contact.familyName = familyName }
    if let middleName = fields.middleName { contact.middleName = middleName }
    if let nickname = fields.nickname { contact.nickname = nickname }
    if let organizationName = fields.organizationName { contact.organizationName = organizationName }
    if let departmentName = fields.departmentName { contact.departmentName = departmentName }
    if let jobTitle = fields.jobTitle { contact.jobTitle = jobTitle }
    if let note = fields.note { contact.note = note }
    if let phoneNumbers = fields.phoneNumbers {
        contact.phoneNumbers = phoneNumbers.map { item in
            CNLabeledValue(label: item.label, value: CNPhoneNumber(stringValue: item.value))
        }
    }
    if let emailAddresses = fields.emailAddresses {
        contact.emailAddresses = emailAddresses.map { item in
            CNLabeledValue(label: item.label, value: item.value as NSString)
        }
    }
    if let postalAddresses = fields.postalAddresses {
        contact.postalAddresses = postalAddresses.map { item in
            let address = CNMutablePostalAddress()
            address.street = item.street ?? ""
            address.city = item.city ?? ""
            address.state = item.state ?? ""
            address.postalCode = item.postalCode ?? ""
            address.country = item.country ?? ""
            return CNLabeledValue(label: item.label, value: address)
        }
    }
}

func contactMatchesQuery(_ contact: CNContact, _ normalizedQuery: String) -> Bool {
    let haystack = [
        contact.givenName,
        contact.middleName,
        contact.familyName,
        contact.nickname,
        contact.organizationName,
        contact.departmentName,
        contact.jobTitle,
        contact.note
    ].joined(separator: " ").lowercased()

    return haystack.contains(normalizedQuery)
}

func serializeContact(_ contact: CNContact) -> [String: Any] {
    return [
        "identifier": contact.identifier,
        "givenName": contact.givenName,
        "middleName": contact.middleName,
        "familyName": contact.familyName,
        "nickname": contact.nickname,
        "organizationName": contact.organizationName,
        "departmentName": contact.departmentName,
        "jobTitle": contact.jobTitle,
        "note": contact.note,
        "phoneNumbers": contact.phoneNumbers.map { labeled in
            [
                "label": labeled.label ?? "",
                "value": labeled.value.stringValue
            ]
        },
        "emailAddresses": contact.emailAddresses.map { labeled in
            [
                "label": labeled.label ?? "",
                "value": labeled.value as String
            ]
        },
        "postalAddresses": contact.postalAddresses.map { labeled in
            [
                "label": labeled.label ?? "",
                "street": labeled.value.street,
                "city": labeled.value.city,
                "state": labeled.value.state,
                "postalCode": labeled.value.postalCode,
                "country": labeled.value.country
            ]
        }
    ]
}

func emitMacContactsActuatorJson(_ payload: [String: Any]) {
    let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    if let data, let line = String(data: data, encoding: .utf8) {
        print(line)
    } else {
        print("{\"ok\":false,\"error\":\"json_serialization_failed\"}")
        exit(1)
    }
}
#else
func runMacContactsActuatorFromStandardInput() {
    print("{\"ok\":false,\"error\":\"contacts_unavailable\"}")
    exit(1)
}
#endif
