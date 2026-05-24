#import <Contacts/Contacts.h>

NS_ASSUME_NONNULL_BEGIN

/// ObjC bridge for `enumeratorForChangeHistoryFetchRequest:error:` (unavailable in Swift).
@interface ContactsHistoryBridge : NSObject

- (instancetype)initWithStore:(CNContactStore *)store;
- (nullable CNFetchResult<NSEnumerator<CNChangeHistoryEvent *> *> *)fetchChangeHistory:(CNChangeHistoryFetchRequest *)request
                                                                                error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
