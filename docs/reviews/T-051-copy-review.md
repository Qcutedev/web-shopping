# T-051 admin Thai copy review

Scope: `th.admin` in `src/i18n/th.ts` (lines 953 to 1403), admin pages in `src/app/admin/**`, components in `src/components/admin/**`. Read-only review. No string below is applied. Owner must approve every Thai change first (th.ts header says the whole block is a proposal).

Compared against: `th.order`, `th.seller` (status labels, notices), `th.notice`, and REQ-A-01 to REQ-A-10 with BR-14, BR-20, BR-21, BR-27, BR-28, BR-33, BR-36.

## Summary

- Hard-coded user-facing strings in `src/app/admin/**` and `src/components/admin/**` (non-test): none found. Grep for Thai characters returned no match; page `title` metadata all read `th.admin.*`.
- Approved texts are used verbatim: `th.order.paymentFailed` "ชำระเงินไม่สำเร็จ" and `th.admin.orders.refundOutside` "ยกเลิกแล้ว คืนเงินนอกระบบ".
- Mock and simulated labelling: present on the dashboard sales card, orders table, order detail (payment, shipping fee, shipment, totals). Missing on the report (finding F-1).
- Tone: polite, "กรุณา" for instructions, "ผู้ใช้" for third person, consistent with th.seller and th.order. Filter button words match th.seller ("ใช้ตัวกรอง", "ล้างตัวกรอง").
- Findings: 2 labelling or rule mismatches (F-1, F-2), 1 wording conflict across the block (F-3), 8 clarity edits, 4 questions for the owner, 3 non-copy notes.

## Findings that need a decision

### F-1 Report revenue has no mock-payment label (CLAUDE.md "mock payment ... labelled in UI")

`reports-section.tsx` renders `revenue` and `orders` with no `th.notice.mockPayment`. `th.admin.reports.paidNote` does not say the payments are simulated. The dashboard sales card does show the label (`dashboard-section.tsx:80`), so the report is inconsistent.

- `reports.paidNote`
  - old: คำสั่งซื้อและยอดขายนับตามวันที่ชำระเงิน ไม่ใช่วันที่สั่งซื้อ ยอดขายรวมเฉพาะราคาสินค้า ไม่รวมค่าจัดส่ง
  - new: คำสั่งซื้อและยอดขายนับตามวันที่ชำระเงิน ไม่ใช่วันที่สั่งซื้อ ยอดขายรวมเฉพาะราคาสินค้า ไม่รวมค่าจัดส่ง และเป็นยอดจากการชำระเงินจำลอง ไม่มีเงินจริง
  - reason: states the mock nature in text, same wording idea as `dashboard.payNote`.
- Component request (frontend): also render `<NoticeLabel>{th.notice.mockPayment}</NoticeLabel>` beside the revenue figure, as the dashboard does. Not a string change.

### F-2 Failed-order note says "cancelled", BR-20 says the order is marked failed, never a cancellation

BR-20 (5): marked "ชำระเงินไม่สำเร็จ", "and never" the refund-outside text. The `PartStatus` comment says "never a cancellation". `orders.failedNote` says the order was "ถูกยกเลิกโดยระบบ". Customer copy (`th.order.confirmation.failedBody`) also says "ถูกยกเลิก", so this may be intended; the owner decides.

- `orders.failedNote`
  - old: การชำระเงินจำลองไม่สำเร็จ คำสั่งซื้อนี้ถูกยกเลิกโดยระบบ ไม่สามารถเปลี่ยนสถานะได้
  - new: การชำระเงินจำลองไม่สำเร็จ สต็อกถูกคืนและสินค้ากลับเข้าตะกร้าของผู้ซื้อแล้ว ไม่สามารถเปลี่ยนสถานะคำสั่งซื้อนี้ได้
  - reason: matches BR-20 effects (stock restored, items returned to cart); avoids the word "cancelled" for a state defined as failed. Keep the old text if the owner accepts "cancelled" as consistent with the customer copy.
  - note: for a timed-out order the cause is not a decline; the text "การชำระเงินจำลองไม่สำเร็จ" fits both (BR-20 treats them alike).

### F-3 "ปิดบัญชี" vs "ปิดใช้งาน" for the same action

Users: status badge says "ปิดใช้งาน", the button says "ปิดบัญชี". Categories use "ปิดใช้งาน"/"เปิดใช้งาน" for the same on/off idea. "ปิดบัญชี" in Thai commonly means closing or deleting an account permanently, which this is not (reversible, REQ-A-02). Proposal: use "ปิดใช้งานบัญชี"/"เปิดใช้งานบัญชี" throughout.

| key | old | new |
| --- | --- | --- |
| users.deactivate | ปิดบัญชี | ปิดใช้งานบัญชี |
| users.reactivate | เปิดบัญชี | เปิดใช้งานบัญชี |
| users.deactivateConfirm | ยืนยันการปิดบัญชีผู้ใช้นี้ใช่หรือไม่ | ยืนยันการปิดใช้งานบัญชีผู้ใช้นี้ใช่หรือไม่ |
| users.deactivateConfirmAction | ยืนยันปิดบัญชี | ยืนยันปิดใช้งานบัญชี |
| users.reactivateConfirm | ยืนยันการเปิดบัญชีผู้ใช้นี้ใช่หรือไม่ | ยืนยันการเปิดใช้งานบัญชีผู้ใช้นี้ใช่หรือไม่ |
| users.reactivateConfirmAction | ยืนยันเปิดบัญชี | ยืนยันเปิดใช้งานบัญชี |
| users.deactivated | ปิดบัญชีผู้ใช้แล้ว | ปิดใช้งานบัญชีผู้ใช้แล้ว |
| users.reactivated | เปิดบัญชีผู้ใช้แล้ว | เปิดใช้งานบัญชีผู้ใช้แล้ว |
| errors.reasons.SELF_DEACTIVATION | ไม่สามารถปิดบัญชีของตัวเองได้ | ไม่สามารถปิดใช้งานบัญชีของตัวเองได้ |
| errors.reasons.LAST_ADMIN | ไม่สามารถปิดบัญชีผู้ดูแลระบบคนสุดท้ายที่ยังใช้งานอยู่ได้ | ไม่สามารถปิดใช้งานบัญชีผู้ดูแลระบบคนสุดท้ายที่ยังใช้งานอยู่ได้ |

Reason: one term per thing; avoids implying deletion. Tests that assert these strings (`actions.test.tsx`, `lists.test.tsx`) read from th.ts or may hard-code; frontend must re-run them after any change.

## Clarity and accuracy edits

| # | key | old | new | reason |
| --- | --- | --- | --- | --- |
| C-1 | users.description | ค้นหาผู้ใช้ ปิดหรือเปิดใช้งานบัญชี ระบบไม่มีการเปลี่ยนบทบาทของผู้ใช้ | ค้นหาผู้ใช้ ปิดหรือเปิดใช้งานบัญชี หน้านี้ไม่สามารถเปลี่ยนบทบาทของผู้ใช้ได้ | Second clause is stilted; says what the admin can not do here (BR-26). |
| C-2 | users.deactivateConfirmNote (last sentence) | คำสั่งซื้อที่มีอยู่จะไม่เปลี่ยน ต้องยกเลิกทีละรายการด้วยตนเอง | คำสั่งซื้อที่มีอยู่จะไม่เปลี่ยนและสต็อกไม่ขยับ หากต้องการยกเลิกคำสั่งซื้อที่ชำระเงินแล้วของร้านนี้ ให้ยกเลิกทีละรายการที่หน้าคำสั่งซื้อ | BR-27 / REQ-A-02: only paid orders are cancelled by hand, no stock moves, and where to do it. Old text reads as if cancelling is mandatory for all orders. |
| C-3 | users.reactivateConfirmNote | ผู้ใช้ต้องเข้าสู่ระบบใหม่ ร้านค้าและสินค้าของผู้ใช้จะกลับมาแสดงตามสถานะเดิม | ผู้ใช้ต้องเข้าสู่ระบบใหม่ ร้านค้าและสินค้าของผู้ใช้จะกลับมาแสดงตามสถานะเดิม (ร้านค้าที่ถูกระงับอยู่ยังคงถูกระงับ) | BR-27: a suspended store stays suspended. |
| C-4 | stores.suspendConfirmNote | สินค้าของร้านจะถูกซ่อนและร้านจะรับคำสั่งซื้อใหม่ไม่ได้ ผู้ขายยังดูข้อมูลและจัดการคำสั่งซื้อที่มีอยู่ได้ กรุณาระบุเหตุผล | สินค้าของร้านจะถูกซ่อนและร้านจะรับคำสั่งซื้อใหม่ไม่ได้ ผู้ขายยังจัดการคำสั่งซื้อที่มีอยู่ได้ แต่แก้ไขร้านค้า สินค้า และสต็อกไม่ได้จนกว่าจะคืนสถานะ กรุณาระบุเหตุผล | BR-14: everything except fulfilment is view only. Matches seller banner `th.seller` (line 521). |
| C-5 | products.approveConfirmNote | สินค้าจะแสดงในร้านและขายได้ทันที | สินค้าจะแสดงในร้านและขายได้ทันที หากร้านค้าและหมวดหมู่ยังใช้งานอยู่ | BR-05, BR-23, BR-27: approval alone does not make it visible. "ทันที" alone over-promises. |
| C-6 | products.rejectConfirmNote | สินค้าจะไม่แสดงในร้าน ผู้ขายแก้ไขแล้วส่งตรวจใหม่ได้ กรุณาระบุเหตุผล | สินค้าจะไม่แสดงในร้าน เมื่อผู้ขายแก้ไขและบันทึก สินค้าจะกลับเข้าคิวรออนุมัติเอง กรุณาระบุเหตุผล | BR-19 / Q20: there is no separate resubmit action; "ส่งตรวจใหม่" suggests a button. |
| C-7 | products.takedownConfirmNote (second sentence) | ผู้ขายแก้ไขแล้วส่งตรวจใหม่ได้ | เมื่อผู้ขายแก้ไขและบันทึก สินค้าจะกลับเข้าคิวรออนุมัติเอง | same as C-6. |
| C-8 | orders.filter.orderNumber | หมายเลขคำสั่งซื้อ (ตรงทั้งหมด) | หมายเลขคำสั่งซื้อ (ต้องพิมพ์ให้ตรงทั้งหมด) | "ตรงทั้งหมด" alone is ambiguous. |
| C-9 | orders.refundOutsideNote | ระบบไม่ได้บันทึกการคืนเงิน การชำระเงินยังเป็นชำระแล้ว | ระบบไม่ได้บันทึกการคืนเงิน สถานะการชำระเงินยังคงเป็นชำระแล้ว | Reads as a status, not an action. Matches BR-21 (payment stays PAID). |
| C-10 | orders.actions.note | ผู้ดูแลระบบยกเลิกได้เฉพาะส่วนที่รอร้านยืนยันหรือกำลังเตรียมสินค้า และทำเครื่องหมายจัดส่งสำเร็จได้เฉพาะส่วนที่จัดส่งแล้ว | (same, drop) | `actions.note` is not referenced in `order-section.tsx` (only heading, none, shippedLocked). Either show it or remove the key. See N-1. |
| C-11 | products.revision | ฉบับที่ตรวจ | ฉบับแก้ไขที่ส่งตรวจ | "ฉบับที่ตรวจ" can read as "the version checked [by me]". The number is the revision the decision applies to (`decisionNote`). Owner may keep. |
| C-12 | settings.shippingFee | ค่าจัดส่งคงที่ต่อร้านค้า (บาท) | ค่าจัดส่งคงที่ต่อคำสั่งซื้อของแต่ละร้านค้า (บาท) | BR-08: flat fee per seller order, not per store overall. Optional; old is acceptable shorthand and matches `th.checkout` line 120 wording. Low priority. |

## Questions for the owner

1. Audit log shows raw codes: `action` (for example `STORE_SUSPENDED`), `targetType` (for example `Store`), and the `metadata` JSON with English keys, in a Thai UI. The filter labels also embed these English examples. Recommended default for the MVP: keep raw codes (admins are technical staff, filters need exact values), and add a Thai gloss map as `LATER`. Decide: keep or translate.
2. `common.reasonHelper` says "ผู้ที่เกี่ยวข้องอาจเห็นเหตุผลนี้". REQUIREMENTS.md does not say who sees a rejection, takedown, or suspension reason. Seller banner shows a store suspension reason (`th.seller` line 523). Is the reason shown to the seller (and to the applicant for a rejected application)? Recommended: yes for product and store reasons; then say "ผู้ขายจะเห็นเหตุผลนี้" per action.
3. `reports.newSellers` is "ร้านค้าใหม่" but REQ-A-08 says "new sellers". Does the figure count new stores or new users with the seller role? Today they coincide (approval creates both). Recommended: keep "ร้านค้าใหม่" if the counted row is a store.
4. `nav.auditLogs` and `audit.title` use "บันทึกการดำเนินการ". "บันทึกการตรวจสอบ" is the more usual Thai term for an audit log. Recommended default: keep the current wording (it says what is recorded); owner may prefer the usual term.

## Non-copy notes (for frontend or orchestrator)

- N-1 Unused keys in `th.admin`: `dashboard.payNote` (the component uses `th.notice.mockPayment` instead), `orders.actions.note`, `orders.view` is used but duplicates `common.view`. Remove or use them, or keep them intentionally and say so. Verified by grep of `src/components/admin` and `src/app/admin`; I did not check every key.
- N-2 Filters ask the admin to type IDs (`store`, `user`, `targetId`, `actorId`: "ร้านค้า (รหัส)", "ผู้ซื้อ (รหัส)"). Wording is clear; usability is a UI question, not copy.
- N-3 Several admin pages show user ids instead of names (`orders.buyer`, `audit.columns.actor`). The labels correctly say "(รหัส)". No change.

## Checked and fine

- Match to admin stories: dashboard groups (REQ-A-01 four groups; `ordersNote` and `salesNote` state BR-33 rules and "all time"); application approve/reject with required reason on reject only (REQ-A-03; `approveConfirmNote` states store creation and role change); suspend and reinstate both ask for a reason (REQ-A-04); category deletion blocked with products (`CATEGORY_HAS_PRODUCTS`, REQ-A-06); settings limits 0 to 1,000 THB and 0 to 100 whole percent (BR-28, field errors state both bounds and "no decimals"); report range note says paid date (REQ-A-08); `common.dateNote` states Asia/Bangkok and inclusive ends (REQ-A-07); shipped part cannot be cancelled (`shippedLocked`, BR-29); `ignoredFilters` states both ends are needed for the paid range (BR-40, Q44).
- Mock and simulated labelling in `order-section.tsx`: payment badge plus `th.notice.mockPayment`, shipping fee and shipment titled with `th.notice.simulatedShipping`, plus `shipmentSimulated` text, totals row labelled. `settings.shippingFeeHelper` says "ค่าจัดส่งจำลอง"; `commissionHelper` says nothing real is deducted (BR-13).
- Terms shared with the rest of th.ts: ร้านค้า, ผู้ขาย, คำสั่งซื้อ, จัดส่งสำเร็จ, ถอดออกจากการขาย, รอร้านค้ายืนยัน; status labels reuse `th.seller.status.*`.

## Not run

- No tests or builds run; read-only review of source and docs.
- Rendered pages were not viewed; length and wrapping of long notes (for example `users.deactivateConfirmNote`) not checked visually.
