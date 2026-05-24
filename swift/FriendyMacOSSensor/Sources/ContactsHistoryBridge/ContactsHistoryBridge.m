#import "ContactsHistoryBridge.h"

@implementation ContactsHistoryBridge {
    CNContactStore *_store;
}

- (instancetype)initWithStore:(CNContactStore *)store {
    self = [super init];
    if (self) {
        _store = store;
    }
    return self;
}

- (CNFetchResult<NSEnumerator<CNChangeHistoryEvent *> *> *)fetchChangeHistory:(CNChangeHistoryFetchRequest *)request
                                                                        error:(NSError *_Nullable *_Nullable)error {
    return [_store enumeratorForChangeHistoryFetchRequest:request error:error];
}

@end
