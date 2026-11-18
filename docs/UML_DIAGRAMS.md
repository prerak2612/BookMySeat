# UML Diagrams

All diagrams are written in PlantUML and live in [`docs/uml/`](uml/). Each one is also embedded below so it renders directly in IDE plugins and Markdown viewers that support `plantuml` code blocks. Every participant, class and method name is taken from the actual source code.

## How to render

- **VS Code / IntelliJ**: install the *PlantUML* extension and preview any `.puml` file (requires Java; Graphviz is needed for the class and use-case diagrams).
- **CLI**: download `plantuml.jar` from https://plantuml.com/download and run `java -jar plantuml.jar -tsvg docs/uml/*.puml` (SVGs are written next to the sources).
- **Online**: paste a file's contents into https://www.plantuml.com/plantuml.

> Note: the diagrams were not rendered in the build environment (no PlantUML installation was available); they use only standard PlantUML syntax.

## Index

| Diagram | File | Main code it describes |
|---|---|---|
| A. Use Case Diagram | [`use-case.puml`](uml/use-case.puml) | `backend/src/http/routes.ts` (one use case per route), `backend/src/services/*` |
| B. Class Diagram (complete backend) | [`class-diagram.puml`](uml/class-diagram.puml) | `backend/src/domain`, `repositories`, `concurrency`, `services`, `pricing`, `payments`, `notifications`, `common/errors.ts`, `db`, `http/controllers` |
| C1. Sequence - Movie browsing | [`seq-01-movie-browsing.puml`](uml/seq-01-movie-browsing.puml) | `frontend/src/pages/MoviesPage.tsx`, `backend/src/http/controllers/controllers.ts` (`MovieController.list/get`), `services/MovieService.ts`, `repositories/pg/PgMovieRepository.ts` |
| C2. Sequence - Show selection | [`seq-02-show-selection.puml`](uml/seq-02-show-selection.puml) | `frontend/src/pages/MovieDetailsPage.tsx`, `services/ShowService.ts`, `repositories/pg/PgShowRepository.ts` |
| C3. Sequence - Seat availability (Observer) | [`seq-03-seat-availability.puml`](uml/seq-03-seat-availability.puml) | `frontend/src/patterns/SeatAvailabilityPoller.ts`, `patterns/seatSelectionStrategies.ts`, `components/SeatMap.tsx`, `backend/src/services/SeatAvailabilityService.ts` |
| C4. Sequence - Successful booking (seat hold) | [`seq-04-successful-booking.puml`](uml/seq-04-successful-booking.puml) | `services/BookingService.ts#createHold`, `services/SeatLockService.ts#hold`, `concurrency/SeatLockingStrategy.ts`, `repositories/pg/PgShowSeatRepository.ts`, `PgBookingRepository.ts` |
| C5. Sequence - Concurrent booking attempts | [`seq-05-concurrent-booking.puml`](uml/seq-05-concurrent-booking.puml) | `concurrency/SeatLockingStrategy.ts`, `db/migrations/001_initial_schema.sql`, `tests/concurrency/booking-concurrency.test.ts` |
| C6. Sequence - Booking conflict in the UI | [`seq-06-booking-conflict.puml`](uml/seq-06-booking-conflict.puml) | `frontend/src/pages/SeatSelectionPage.tsx`, `api/httpClient.ts` |
| C7. Sequence - Payment success | [`seq-07-payment-success.puml`](uml/seq-07-payment-success.puml) | `services/BookingService.ts#pay`, `payments/*`, `notifications/*` |
| C8. Sequence - Payment failure | [`seq-08-payment-failure.puml`](uml/seq-08-payment-failure.puml) | `services/BookingService.ts#pay`, `payments/gateway/LegacyPaySdk.ts` (simulation rules), `tests/integration/bookings.test.ts` |
| C9. Sequence - Booking cancellation | [`seq-09-cancellation.puml`](uml/seq-09-cancellation.puml) | `domain/Booking.ts#cancel`, `services/BookingService.ts#cancel`, `frontend/src/pages/BookingPages.tsx` |
| D. Activity Diagram - Complete booking workflow | [`activity-booking.puml`](uml/activity-booking.puml) | `services/BookingService.ts`, `services/SeatLockService.ts`, `services/HoldExpiryJob.ts`, `frontend/src/pages/*` |

## A. Use Case Diagram

Actors: **Customer**, **Admin** (generalises Customer, so an admin can also book) and the system actor **Hold Expiry Job** (`HoldExpiryJob`). `Pay` *includes* hold validation (`SeatLockService.assertStillHeld`, `Booking.assertPayable`); `Refund payment` *extends* `Cancel booking` only for confirmed bookings before the cut-off (`Booking.cancel` returns `refundRequired`).

**Code:** `backend/src/http/routes.ts` (one use case per route), `backend/src/services/*`

```plantuml
@startuml use-case
title BookMySeat - Use Case Diagram
left to right direction
skinparam packageStyle rectangle

actor Customer as C
actor Admin as A
actor "Hold Expiry Job" as J <<system>>
A -|> C

rectangle "BookMySeat" {
  usecase "Register" as UC_REG
  usecase "Log in" as UC_LOGIN
  usecase "Browse / search movies" as UC_BROWSE
  usecase "View movie details" as UC_DETAILS
  usecase "View shows\n(by day / city / theatre)" as UC_SHOWS
  usecase "View seat map &\nreal-time availability" as UC_SEATS
  usecase "Hold seats\n(temporary lock)" as UC_HOLD
  usecase "Pay for booking\n(simulated)" as UC_PAY
  usecase "Validate seat hold" as UC_VALIDATE
  usecase "View booking confirmation" as UC_CONFIRM
  usecase "View booking history" as UC_HISTORY
  usecase "Cancel booking /\nrelease hold" as UC_CANCEL
  usecase "Refund payment" as UC_REFUND
  usecase "View notifications" as UC_NOTIF
  usecase "Expire abandoned holds" as UC_EXPIRE

  usecase "Manage movies\n(create / update / deactivate)" as UC_MOVIES
  usecase "Manage theatres" as UC_THEATRES
  usecase "Add screen with seat layout" as UC_SCREENS
  usecase "Schedule show" as UC_SCHEDULE
  usecase "View dashboard statistics" as UC_STATS
  usecase "View all bookings" as UC_ALLBOOKINGS
}

C --> UC_REG
C --> UC_LOGIN
C --> UC_BROWSE
C --> UC_DETAILS
C --> UC_SHOWS
C --> UC_SEATS
C --> UC_HOLD
C --> UC_PAY
C --> UC_CONFIRM
C --> UC_HISTORY
C --> UC_CANCEL
C --> UC_NOTIF

A --> UC_MOVIES
A --> UC_THEATRES
A --> UC_SCREENS
A --> UC_SCHEDULE
A --> UC_STATS
A --> UC_ALLBOOKINGS

J --> UC_EXPIRE

UC_HOLD ..> UC_SEATS : <<include>>
UC_PAY ..> UC_VALIDATE : <<include>>
UC_REFUND ..> UC_CANCEL : <<extend>>\n(confirmed booking,\nbefore cut-off)

note right of UC_HOLD
  Requires login.
  Idempotency-Key header supported.
  Concurrency-safe: at most one
  active hold per show seat.
end note
@enduml
```

## B. Class Diagram (complete backend)

Packages mirror the source folders. Shows inheritance (`Entity` → entities, `User` → `Customer`/`Admin`, `AppError` hierarchy, abstract strategies/decorators), realization of every repository/strategy interface, **composition** (`Screen *-- Seat`, `Booking *-- BookingSeat`), **aggregation** (`Theatre o-- Screen`, `BookingEventPublisher o-- BookingEventListener`), **association** (`Show --> Movie`, `Show --> Screen`) and **dependency** (`..>`). Visibility: `+` public, `-` private (TypeScript `#private`/`private`), `#` protected.

**Code:** `backend/src/domain`, `repositories`, `concurrency`, `services`, `pricing`, `payments`, `notifications`, `common/errors.ts`, `db`, `http/controllers`

```plantuml
@startuml class-diagram
title BookMySeat - Class Diagram (backend)
skinparam classAttributeIconSize 0
skinparam packageStyle rectangle
hide empty members

' =====================================================================
package "domain" {
  abstract class Entity {
    +id: number
    #Entity(id: number)
    +equals(other: Entity): boolean
  }

  enum UserRole {
    CUSTOMER
    ADMIN
  }
  enum SeatCategory {
    REGULAR
    PREMIUM
    RECLINER
  }
  enum ShowStatus {
    SCHEDULED
    CANCELLED
  }
  enum ShowSeatStatus {
    AVAILABLE
    LOCKED
    BOOKED
  }
  enum BookingStatus {
    PENDING
    CONFIRMED
    CANCELLED
    EXPIRED
    FAILED
  }
  enum PaymentMethod {
    CARD
    UPI
    WALLET
  }
  enum PaymentStatus {
    SUCCESS
    FAILED
    REFUNDED
  }

  abstract class User {
    +name: string
    +email: string
    +createdAt: Date
    -passwordHash: string
    +{abstract} role: UserRole
    +{abstract} canManageCatalog(): boolean
    +canAccessBookingOf(ownerId: number): boolean
    +toPublic(): PublicUser
  }
  class Customer {
    +role: UserRole = CUSTOMER
    +canManageCatalog(): boolean = false
  }
  class Admin {
    +role: UserRole = ADMIN
    +canManageCatalog(): boolean = true
  }
  class UserFactory <<Factory>> {
    +{static} create(props: UserProps): User
  }

  class Movie {
    +title: string
    +description: string
    +durationMinutes: number
    +language: string
    +genre: string
    +certificate: string
    +releaseDate: string
    +posterUrl: string | null
    +isActive: boolean
    +occupiedMinutes(cleaningBufferMinutes: number = 15): number
  }

  class Theatre {
    +name: string
    +city: string
    +address: string
    -screens: Screen[]
    +screens(): Screen[]
  }
  class Screen {
    +theatreId: number
    +name: string
    -seats: Seat[]
    -capacityHint: number
    +seats(): Seat[]
    +capacity(): number
  }
  class Seat {
    +screenId: number
    +rowLabel: string
    +seatNumber: number
    +category: SeatCategory
    +label(): string
  }

  class Show {
    +movieId: number
    +screenId: number
    +startTime: Date
    +endTime: Date
    +basePrice: number
    +status: ShowStatus
    +isBookableAt(now: Date): boolean
    +minutesUntilStart(now: Date): number
    +isWeekend(): boolean
  }

  class ShowSeat <<state machine>> {
    +showId: number
    +seatId: number
    +rowLabel: string
    +seatNumber: number
    +category: SeatCategory
    +version: number
    -status: ShowSeatStatus
    -bookingId: number | null
    -lockExpiresAt: Date | null
    +hasExpiredLock(now: Date): boolean
    +isAvailableAt(now: Date): boolean
    +isHeldBy(bookingId: number, now: Date): boolean
    +effectiveStatus(now: Date): ShowSeatStatus
    +lock(bookingId: number, expiresAt: Date, now: Date): void
    +book(bookingId: number, now: Date): void
    +release(): void
  }

  class Booking <<aggregate root>> {
    +reference: string
    +userId: number
    +showId: number
    +subtotal: number
    +totalAmount: number
    +priceBreakdown: PriceLine[]
    +idempotencyKey: string | null
    +expiresAt: Date
    +createdAt: Date
    -status: BookingStatus
    -confirmedAt: Date | null
    -cancelledAt: Date | null
    -seats: BookingSeat[]
    +isHoldExpired(now: Date): boolean
    +assertPayable(now: Date): void
    +confirm(now: Date): void
    +markPaymentFailed(): void
    +expire(): void
    +cancel(now: Date, show: Show, cutoffMinutes: number): CancellationOutcome
    +isCancellable(now: Date, show: Show, cutoffMinutes: number): boolean
    -transitionToTerminal(target: BookingStatus, allowedFrom: BookingStatus[]): void
  }
  class BookingSeat <<value>> {
    +showSeatId: number
    +seatLabel: string
    +category: string
    +price: number
    +isActive: boolean
  }
  class BookingDraft <<value>> {
    +reference: string
    +userId: number
    +showId: number
    +subtotal: number
    +totalAmount: number
    +priceBreakdown: PriceLine[]
    +idempotencyKey: string | null
    +expiresAt: Date
    +seats: BookingSeat[]
  }
  class BookingBuilder <<Builder>> {
    -userId: number
    -showId: number
    -seats: BookingSeat[]
    -expiresAt: Date
    +forUser(userId: number): BookingBuilder
    +forShow(showId: number): BookingBuilder
    +withSeat(seat: BookingSeat): BookingBuilder
    +withPricing(subtotal: number, total: number, lines: PriceLine[]): BookingBuilder
    +withIdempotencyKey(key: string): BookingBuilder
    +holdUntil(expiresAt: Date): BookingBuilder
    +build(): BookingDraft
    +{static} generateReference(): string
  }

  class Payment {
    +bookingId: number
    +amount: number
    +method: PaymentMethod
    +gateway: string
    +transactionRef: string | null
    +failureReason: string | null
    +idempotencyKey: string | null
    -status: PaymentStatus
    -refundedAt: Date | null
    +markRefunded(now: Date): void
  }
}

Entity <|-- User
Entity <|-- Movie
Entity <|-- Theatre
Entity <|-- Screen
Entity <|-- Seat
Entity <|-- Show
Entity <|-- ShowSeat
Entity <|-- Booking
Entity <|-- Payment
User <|-- Customer
User <|-- Admin
UserFactory ..> Customer : creates
UserFactory ..> Admin : creates

Theatre "1" o-- "0..*" Screen : aggregates
Screen "1" *-- "1..*" Seat : composes
Show "0..*" --> "1" Movie : plays
Show "0..*" --> "1" Screen : on
ShowSeat "0..*" --> "1" Show
ShowSeat "0..*" --> "1" Seat
Booking "1" *-- "1..*" BookingSeat : line items
Booking "0..*" --> "1" Show
Booking "0..*" --> "1" User : made by
BookingSeat "0..*" --> "1" ShowSeat
Payment "0..*" --> "1" Booking
BookingBuilder ..> BookingDraft : builds
Booking ..> Show : uses (cancel rules)

' =====================================================================
package "repositories" {
  interface UserRepository {
    +findById(id: number): Promise<User>
    +findByEmail(email: string): Promise<User>
    +create(data: UserProps): Promise<User>
  }
  interface MovieReader {
    +findById(id: number): Promise<Movie>
    +search(filter: MovieFilter): Promise<Movie[]>
  }
  interface MovieWriter {
    +create(data: MovieProps): Promise<Movie>
    +update(id: number, data: MovieProps): Promise<Movie>
  }
  interface MovieRepository
  interface TheatreRepository {
    +list(city: string): Promise<Theatre[]>
    +findById(id: number): Promise<Theatre>
    +create(data): Promise<Theatre>
    +findScreenById(id: number): Promise<Screen>
    +createScreen(theatreId: number, name: string, seats: SeatCreate[]): Promise<Screen>
    +listCities(): Promise<string[]>
  }
  interface ShowRepository {
    +findById(id: number): Promise<Show>
    +findDetails(id: number, now: Date): Promise<ShowDetails>
    +listForMovie(movieId: number, filter: ShowFilter, now: Date): Promise<ShowListing[]>
    +createWithInventory(data): Promise<Show>
  }
  interface ShowSeatRepository {
    +findByShow(showId: number): Promise<ShowSeat[]>
    +findByShowAndSeatIds(showId: number, seatIds: number[], options: LockOptions): Promise<ShowSeat[]>
    +findByIds(ids: number[], options: LockOptions): Promise<ShowSeat[]>
    +lockSeats(ids: number[], bookingId: number, expiresAt: Date): Promise<void>
    +lockSeatsIfUnchanged(seats: IdVersion[], bookingId: number, expiresAt: Date): Promise<number[]>
    +markBooked(ids: number[], bookingId: number): Promise<number>
    +releaseForBooking(bookingId: number, ids: number[]): Promise<number>
    +releaseOrphanedLocks(now: Date): Promise<number>
  }
  interface BookingRepository {
    +createHeader(draft: BookingDraft): Promise<number>
    +addLines(bookingId: number, seats: BookingSeat[]): Promise<void>
    +findById(id: number, options: LockOptions): Promise<Booking>
    +findByIds(ids: number[], options: LockOptions): Promise<Booking[]>
    +findByUserAndIdempotencyKey(userId: number, key: string): Promise<Booking>
    +save(booking: Booking): Promise<void>
    +deactivateLinesForShowSeats(showSeatIds: number[]): Promise<void>
    +findExpiredPendingIds(now: Date, limit: number): Promise<number[]>
    +findSummary(id: number): Promise<BookingSummary>
    +listSummariesByUser(userId: number): Promise<BookingSummary[]>
    +listSummaries(filter): Promise<BookingSummary[]>
  }
  interface PaymentRepository {
    +create(payment: NewPayment): Promise<Payment>
    +findByBookingAndKey(bookingId: number, key: string): Promise<Payment>
    +findSuccessfulByBooking(bookingId: number): Promise<Payment>
    +save(payment: Payment): Promise<void>
  }
  interface NotificationRepository {
    +create(n: NotificationRecord): Promise<NotificationRecord>
    +listByUser(userId: number, limit: number): Promise<NotificationRecord[]>
  }
  interface ReportingRepository {
    +stats(now: Date): Promise<AdminStats>
  }
  interface AdvisoryLockRepository {
    +lockForTransaction(key: string): Promise<void>
  }
  interface UnitOfWork {
    +users: UserRepository
    +movies: MovieRepository
    +theatres: TheatreRepository
    +shows: ShowRepository
    +showSeats: ShowSeatRepository
    +bookings: BookingRepository
    +payments: PaymentRepository
    +notifications: NotificationRepository
    +reporting: ReportingRepository
    +advisoryLocks: AdvisoryLockRepository
  }
  interface UnitOfWorkFactory {
    +db: UnitOfWork
    +transaction<T>(work: UnitOfWork => Promise<T>): Promise<T>
  }

  package "pg (PostgreSQL implementations)" {
    class PgUserRepository
    class PgMovieRepository
    class PgTheatreRepository
    class PgShowRepository
    class PgShowSeatRepository
    class PgBookingRepository
    class PgPaymentRepository
    class PgNotificationRepository
    class PgReportingRepository
    class PgAdvisoryLockRepository
    class PgUnitOfWorkFactory {
      +db: UnitOfWork
      -tx: TransactionManager
      +transaction<T>(work): Promise<T>
    }
  }
}

MovieReader <|-- MovieRepository
MovieWriter <|-- MovieRepository
UserRepository <|.. PgUserRepository
MovieRepository <|.. PgMovieRepository
TheatreRepository <|.. PgTheatreRepository
ShowRepository <|.. PgShowRepository
ShowSeatRepository <|.. PgShowSeatRepository
BookingRepository <|.. PgBookingRepository
PaymentRepository <|.. PgPaymentRepository
NotificationRepository <|.. PgNotificationRepository
ReportingRepository <|.. PgReportingRepository
AdvisoryLockRepository <|.. PgAdvisoryLockRepository
UnitOfWorkFactory <|.. PgUnitOfWorkFactory
UnitOfWorkFactory --> UnitOfWork
UnitOfWork o-- ShowSeatRepository
UnitOfWork o-- BookingRepository
UnitOfWork o-- PaymentRepository

' =====================================================================
package "db" {
  class Database <<Singleton>> {
    -{static} instance: Database
    +pool: pg.Pool
    -Database(connectionString: string, max: number)
    +{static} getInstance(): Database
    +{static} close(): Promise<void>
  }
  class TransactionManager {
    -pool: pg.Pool
    +run<T>(work: Queryable => Promise<T>, options: TransactionOptions): Promise<T>
  }
  interface Queryable {
    +query(text: string, params: unknown[]): Promise<QueryResult>
  }
}
PgUnitOfWorkFactory *-- TransactionManager
TransactionManager ..> Queryable : BEGIN/COMMIT/ROLLBACK\n+ retry 40001/40P01
PgShowSeatRepository ..> Queryable

' =====================================================================
package "concurrency" {
  interface SeatLockingStrategy <<Strategy>> {
    +name: SeatLockingStrategyName
    +reserveCandidates(uow: UnitOfWork, showId: number, seatIds: number[], now: Date): Promise<ShowSeat[]>
    +claim(uow: UnitOfWork, seats: ShowSeat[], bookingId: number, expiresAt: Date): Promise<void>
  }
  abstract class AbstractSeatLockingStrategy <<Template Method>> {
    +reserveCandidates(uow, showId, seatIds, now): Promise<ShowSeat[]>
    #{abstract} loadCandidates(uow, showId, seatIds): Promise<ShowSeat[]>
    +{abstract} claim(uow, seats, bookingId, expiresAt): Promise<void>
  }
  class PessimisticSeatLockingStrategy {
    +name = PESSIMISTIC
    #loadCandidates(): SELECT ... FOR UPDATE
    +claim(): lockSeats()
  }
  class OptimisticSeatLockingStrategy {
    +name = OPTIMISTIC
    #loadCandidates(): plain SELECT
    +claim(): lockSeatsIfUnchanged() (version CAS)
  }
}
SeatLockingStrategy <|.. AbstractSeatLockingStrategy
AbstractSeatLockingStrategy <|-- PessimisticSeatLockingStrategy
AbstractSeatLockingStrategy <|-- OptimisticSeatLockingStrategy
AbstractSeatLockingStrategy ..> ShowSeatRepository

' =====================================================================
package "pricing" {
  interface SeatPricingStrategy <<Strategy>> {
    +name: string
    +priceForSeat(category: SeatCategory, basePrice: number): number
  }
  class CategoryPricingStrategy {
    +{static} MULTIPLIERS: Record<SeatCategory, number>
  }
  class FlatPricingStrategy
  interface PriceCalculator {
    +calculate(context: PricingContext): PriceQuote
  }
  class BasePriceCalculator {
    -strategy: SeatPricingStrategy
  }
  abstract class PriceCalculatorDecorator <<Decorator>> {
    #inner: PriceCalculator
    +calculate(context: PricingContext): PriceQuote
    #{abstract} extraCharge(quote: PriceQuote, context: PricingContext): PriceLine
  }
  class WeekendSurchargeDecorator {
    -rate: number
  }
  class ConvenienceFeeDecorator {
    -feePerSeat: number
  }
  class TaxDecorator {
    -rate: number
  }
  class PriceCalculatorFactory <<Factory>> {
    +{static} createStrategy(name): SeatPricingStrategy
    +{static} create(cfg: PricingConfig): PriceCalculator
  }
}
SeatPricingStrategy <|.. CategoryPricingStrategy
SeatPricingStrategy <|.. FlatPricingStrategy
PriceCalculator <|.. BasePriceCalculator
PriceCalculator <|.. PriceCalculatorDecorator
PriceCalculatorDecorator <|-- WeekendSurchargeDecorator
PriceCalculatorDecorator <|-- ConvenienceFeeDecorator
PriceCalculatorDecorator <|-- TaxDecorator
PriceCalculatorDecorator o-- "1" PriceCalculator : wraps
BasePriceCalculator --> SeatPricingStrategy
PriceCalculatorFactory ..> PriceCalculator : builds chain

' =====================================================================
package "payments" {
  interface PaymentProcessor <<Strategy>> {
    +method: PaymentMethod
    +pay(request: PaymentRequest): Promise<PaymentResult>
  }
  interface RefundProcessor {
    +refund(transactionRef: string, amount: number): Promise<RefundResult>
  }
  abstract class BasePaymentStrategy <<Template Method>> {
    #gateway: PaymentGateway
    #{abstract} instrumentType: InstrumentType
    +pay(request: PaymentRequest): Promise<PaymentResult>
    +refund(transactionRef: string, amount: number): Promise<RefundResult>
    #{abstract} validate(details): string[]
    #{abstract} tokenise(details): string
    #{abstract} mask(details): string
  }
  class CardPaymentStrategy
  class UpiPaymentStrategy
  class WalletPaymentStrategy
  class PaymentStrategyFactory <<Factory>> {
    -strategies: Map<PaymentMethod, PaymentStrategy>
    +register(strategy: PaymentStrategy): PaymentStrategyFactory
    +get(method: PaymentMethod): PaymentStrategy
    +supportedMethods(): PaymentMethod[]
    +{static} withDefaults(gateway: PaymentGateway): PaymentStrategyFactory
  }
  class PaymentService <<Facade>> {
    -factory: PaymentStrategyFactory
    +charge(method, amount, bookingReference, details): Promise<PaymentResult>
    +refund(method, transactionRef, amount): Promise<RefundResult>
  }
  interface PaymentGateway {
    +name: string
    +charge(request: GatewayChargeRequest): Promise<GatewayResult>
    +refund(transactionRef: string, amount: number): Promise<GatewayResult>
  }
  class LegacyPayGatewayAdapter <<Adapter>> {
    -sdk: LegacyPaySdk
    +name = LEGACY_PAY
  }
  class LegacyPaySdk <<third-party>> {
    +makeTransaction(payload: LegacyTxnPayload, callback): void
    +reverseTransaction(txnId: string, amountPaise: number, callback): void
  }
  class GatewayUnavailableError
}
PaymentProcessor <|.. BasePaymentStrategy
RefundProcessor <|.. BasePaymentStrategy
BasePaymentStrategy <|-- CardPaymentStrategy
BasePaymentStrategy <|-- UpiPaymentStrategy
BasePaymentStrategy <|-- WalletPaymentStrategy
BasePaymentStrategy --> PaymentGateway
PaymentGateway <|.. LegacyPayGatewayAdapter
LegacyPayGatewayAdapter --> LegacyPaySdk : adapts
LegacyPayGatewayAdapter ..> GatewayUnavailableError : throws
PaymentStrategyFactory o-- "0..*" BasePaymentStrategy
PaymentService --> PaymentStrategyFactory

' =====================================================================
package "notifications" {
  interface BookingEventListener <<Observer>> {
    +name: string
    +handle(event: BookingEvent): Promise<void>
  }
  class BookingEventPublisher <<Subject>> {
    -subscriptions: Subscription[]
    +subscribe(listener: BookingEventListener, types: BookingEventType[]): Unsubscribe
    +publish(event: BookingEvent): Promise<void>
  }
  class NotificationService {
    -users: UserRepository
    -notifications: NotificationRepository
    -channels: NotificationChannel[]
    +handle(event: BookingEvent): Promise<void>
  }
  class AuditLogListener {
    +entries: BookingEvent[]
    +handle(event: BookingEvent): Promise<void>
  }
  interface NotificationChannel {
    +name: string
    +send(recipient, subject: string, message: string): Promise<void>
  }
  class EmailChannel
  class SmsChannel
}
BookingEventListener <|.. NotificationService
BookingEventListener <|.. AuditLogListener
BookingEventPublisher o-- "0..*" BookingEventListener : notifies
NotificationChannel <|.. EmailChannel
NotificationChannel <|.. SmsChannel
NotificationService o-- "1..*" NotificationChannel
NotificationService ..> NotificationRepository

' =====================================================================
package "services" {
  class BookingService <<Application Service>> {
    -uowFactory: UnitOfWorkFactory
    -seatLocks: SeatLockService
    -payments: PaymentService
    -pricing: PriceCalculator
    -events: BookingEventPublisher
    -clock: Clock
    -policy: BookingPolicy
    +createHold(user: User, input, idempotencyKey: string): Promise<HoldResult>
    +pay(user: User, bookingId: number, input, idempotencyKey: string): Promise<BookingView>
    +cancel(user: User, bookingId: number): Promise<BookingView>
    +get(user: User, bookingId: number): Promise<BookingView>
    +listForUser(user: User): Promise<BookingView[]>
    +listAll(filter): Promise<BookingView[]>
    -authorize(user: User, booking: Booking): void
    -withConstraintMapping(seatIds, work): Promise<T>
  }
  class SeatLockService {
    +strategy: SeatLockingStrategy
    +hold(uow: UnitOfWork, params): Promise<Booking>
    +lockBookingForUpdate(uow: UnitOfWork, bookingId: number): Promise<LockedBooking>
    +assertStillHeld(booking: Booking, seats: ShowSeat[], now: Date): void
    +confirmSeats(uow, booking, seats, now): Promise<void>
    +releaseSeats(uow, booking): Promise<number>
    +expireHold(uow, booking): Promise<void>
    -reclaimExpiredHolds(uow, seats, now): Promise<void>
  }
  class HoldExpiryJob {
    -timer: Timeout
    +start(intervalMs: number): void
    +stop(): void
    +runOnce(): Promise<number>
  }
  class SeatAvailabilityService {
    -pricing: SeatPricingStrategy
    +getSeatMap(showId: number): Promise<SeatMap>
  }
  class MovieService {
    -reader: MovieReader
    -writer: MovieWriter
    +list(filter): Promise<Movie[]>
    +get(id: number): Promise<Movie>
    +create(data): Promise<Movie>
    +update(id: number, data): Promise<Movie>
    +deactivate(id: number): Promise<Movie>
  }
  class TheatreService {
    +list(city: string): Promise<Theatre[]>
    +listCities(): Promise<string[]>
    +get(id: number): Promise<Theatre>
    +create(data): Promise<Theatre>
    +getScreen(id: number): Promise<Screen>
    +addScreen(theatreId: number, name: string, layout: LayoutSpec): Promise<Screen>
  }
  class SeatLayoutFactory <<Factory>> {
    +{static} PRESETS: Record<Preset, RowSpec[]>
    +{static} create(spec: LayoutSpec): SeatCreate[]
  }
  class ShowService {
    +listForMovie(movieId: number, filter): Promise<ShowListing[]>
    +get(id: number): Promise<ShowDetails>
    +create(input): Promise<Show>
  }
  class AuthService {
    -users: UserRepository
    -hasher: PasswordHasher
    -tokens: TokenService
    +register(input): Promise<AuthResult>
    +login(input): Promise<AuthResult>
    +authenticate(token: string): Promise<User>
  }
  interface PasswordHasher {
    +hash(plain: string): Promise<string>
    +verify(plain: string, hash: string): Promise<boolean>
  }
  interface TokenService {
    +issue(payload: TokenPayload): string
    +verify(token: string): TokenPayload
  }
  class BcryptPasswordHasher
  class JwtTokenService
  class AdminService {
    -reporting: ReportingRepository
    +stats(): Promise<AdminStats>
  }
  interface Clock {
    +now(): Date
  }
  class SystemClock
  class FixedClock
}
BookingService --> UnitOfWorkFactory
BookingService --> SeatLockService
BookingService --> PaymentService
BookingService --> PriceCalculator
BookingService --> BookingEventPublisher
BookingService --> Clock
BookingService ..> BookingBuilder : uses
SeatLockService --> SeatLockingStrategy
HoldExpiryJob --> SeatLockService
HoldExpiryJob --> BookingEventPublisher
HoldExpiryJob --> UnitOfWorkFactory
SeatAvailabilityService --> SeatPricingStrategy
SeatAvailabilityService --> UnitOfWorkFactory
MovieService --> MovieReader
MovieService --> MovieWriter
TheatreService ..> SeatLayoutFactory
TheatreService --> UnitOfWorkFactory
ShowService --> UnitOfWorkFactory
AuthService --> UserRepository
AuthService --> PasswordHasher
AuthService --> TokenService
PasswordHasher <|.. BcryptPasswordHasher
TokenService <|.. JwtTokenService
AdminService --> ReportingRepository
Clock <|.. SystemClock
Clock <|.. FixedClock

' =====================================================================
package "errors" {
  abstract class AppError {
    +{abstract} statusCode: number
    +{abstract} code: string
    +details: unknown
    +toJSON(): ErrorBody
  }
  class ValidationError <<400>>
  class UnauthorizedError <<401>>
  class PaymentFailedError <<402>>
  class ForbiddenError <<403>>
  class NotFoundError <<404>>
  class ConflictError <<409>>
  class SeatUnavailableError <<409>>
  class HoldExpiredError <<410>>
  class BusinessRuleError <<422>>
}
AppError <|-- ValidationError
AppError <|-- UnauthorizedError
AppError <|-- PaymentFailedError
AppError <|-- ForbiddenError
AppError <|-- NotFoundError
AppError <|-- ConflictError
AppError <|-- BusinessRuleError
ConflictError <|-- SeatUnavailableError
ConflictError <|-- HoldExpiredError
AbstractSeatLockingStrategy ..> SeatUnavailableError : throws
SeatLockService ..> HoldExpiredError : throws

' =====================================================================
package "http" {
  class BookingController {
    +createHold(req, res)
    +pay(req, res)
    +cancel(req, res)
    +get(req, res)
    +listMine(req, res)
    +myNotifications(req, res)
  }
  class MovieController
  class TheatreController
  class ShowController
  class AuthController
  class AdminController
}
BookingController --> BookingService
MovieController --> MovieService
MovieController --> ShowService
TheatreController --> TheatreService
ShowController --> ShowService
ShowController --> SeatAvailabilityService
AuthController --> AuthService
AdminController --> AdminService
AdminController --> BookingService
@enduml
```

## C1. Sequence - Movie browsing

Public read path. `optionalAuthenticate` lets admins see inactive movies; customers never do.

**Code:** `frontend/src/pages/MoviesPage.tsx`, `backend/src/http/controllers/controllers.ts` (`MovieController.list/get`), `services/MovieService.ts`, `repositories/pg/PgMovieRepository.ts`

```plantuml
@startuml seq-01-movie-browsing
title Sequence 1 - Movie browsing
autonumber
actor Customer
participant "MoviesPage\n(React)" as Page
participant "HttpClient" as Http
participant "Express router\n/api/movies" as Router
participant "optionalAuthenticate\n+ validate(MovieQuery)" as MW
participant MovieController
participant MovieService
participant "PgMovieRepository\n(MovieReader)" as Repo
database PostgreSQL as DB

Customer -> Page : open home page
Page -> Http : api.movies.list()
Http -> Router : GET /api/movies
Router -> MW : parse token (optional), validate query
MW -> MovieController : list(req, res)
MovieController -> MovieController : req.user?.canManageCatalog()\n(false -> includeInactive = false)
MovieController -> MovieService : list(filter)
MovieService -> Repo : search(filter)
Repo -> DB : SELECT ... FROM movies WHERE is_active\nORDER BY release_date DESC
DB --> Repo : rows
Repo --> MovieService : Movie[]
MovieService --> MovieController : Movie[]
MovieController --> Http : 200 {success: true, data: movieDto[]}
Http --> Page : Movie[]
Page -> Page : client-side filter (search, genre, language)
Page --> Customer : movie grid

== View movie details ==
Customer -> Page : click movie card
Page -> Http : api.movies.get(id)
Http -> MovieController : GET /api/movies/:id
MovieController -> MovieService : get(id)
MovieService -> Repo : findById(id)
Repo -> DB : SELECT ... WHERE id = $1
alt movie exists
  MovieService --> MovieController : Movie
  MovieController --> Http : 200 movieDto
else not found
  MovieService --> MovieController : throw NotFoundError
  MovieController --> Http : 404 NOT_FOUND (errorHandler)
end
@enduml
```

## C2. Sequence - Show selection

Upcoming shows grouped by day / city / theatre; available-seat counts treat expired locks as free.

**Code:** `frontend/src/pages/MovieDetailsPage.tsx`, `services/ShowService.ts`, `repositories/pg/PgShowRepository.ts`

```plantuml
@startuml seq-02-show-selection
title Sequence 2 - Theatre and show selection
autonumber
actor Customer
participant "MovieDetailsPage\n(React)" as Page
participant HttpClient as Http
participant "validate(IdParam, ShowQuery)" as MW
participant MovieController
participant ShowService
participant PgMovieRepository as Movies
participant PgShowRepository as Shows
database PostgreSQL as DB

Customer -> Page : open /movies/:id
Page -> Http : api.movies.shows(movieId)
Http -> MW : GET /api/movies/:id/shows?date=&city=
MW -> MovieController : shows_(req, res)
MovieController -> ShowService : listForMovie(movieId, {date, city, theatreId})
ShowService -> Movies : findById(movieId)
alt movie missing
  ShowService --> MovieController : throw NotFoundError (404)
end
ShowService -> ShowService : date -> [from, to) range
ShowService -> Shows : listForMovie(movieId, filter, clock.now())
Shows -> DB : SELECT shows JOIN screens JOIN theatres\n+ count of AVAILABLE or expired-LOCKED show_seats\nWHERE status = 'SCHEDULED' AND start_time >= now
DB --> Shows : rows
Shows --> ShowService : ShowListing[]
ShowService --> MovieController : ShowListing[]
MovieController --> Http : 200 data
Http --> Page : ShowListing[]
Page -> Page : group by day tab, city, theatre
Page --> Customer : showtimes (sold out / few left)
Customer -> Page : click showtime
Page --> Customer : navigate to /shows/:id (seat selection)
@enduml
```

## C3. Sequence - Seat availability (Observer)

`SeatAvailabilityPoller` (Subject) polls and notifies the page; the server reports the *effective* status of each seat. Selection behaviour is delegated to a `SeatSelectionStrategy`.

**Code:** `frontend/src/patterns/SeatAvailabilityPoller.ts`, `patterns/seatSelectionStrategies.ts`, `components/SeatMap.tsx`, `backend/src/services/SeatAvailabilityService.ts`

```plantuml
@startuml seq-03-seat-availability
title Sequence 3 - Seat layout and real-time availability (Observer polling)
autonumber
actor Customer
participant SeatSelectionPage as Page
participant SeatAvailabilityPoller as Poller
participant "SeatMap\n(component)" as Grid
participant HttpClient as Http
participant ShowController
participant SeatAvailabilityService as Svc
participant PgShowRepository as Shows
participant PgShowSeatRepository as SeatsRepo
participant "ShowSeat\n(domain)" as SS
participant CategoryPricingStrategy as Pricing
database PostgreSQL as DB

Customer -> Page : open /shows/:id
Page -> Poller : new SeatAvailabilityPoller(showId, api.shows.seats, 5000)
Page -> Poller : subscribe(setState) via useObservable
Page -> Poller : start()
loop every 5 seconds (and on demand via refresh())
  Poller -> Http : api.shows.seats(showId)
  Http -> ShowController : GET /api/shows/:id/seats
  ShowController -> Svc : getSeatMap(showId)
  Svc -> Shows : findDetails(showId, now)
  Shows -> DB : SELECT show + movie + theatre
  Svc -> SeatsRepo : findByShow(showId)
  SeatsRepo -> DB : SELECT show_seats JOIN seats (no lock)
  DB --> SeatsRepo : rows
  SeatsRepo --> Svc : ShowSeat[]
  loop for each ShowSeat
    Svc -> SS : effectiveStatus(now)
    note right : expired LOCKED is reported as AVAILABLE
    Svc -> Pricing : priceForSeat(category, basePrice)
  end
  Svc --> ShowController : SeatMap {rows, summary, categoryPrices, serverTime}
  ShowController --> Http : 200
  Http --> Poller : SeatMap
  Poller -> Poller : emit({seatMap, loading: false})
  Poller --> Page : notify subscribers
  Page -> Page : pruneUnavailable(selected, seatMap)
  Page -> Grid : render(seatMap, selected)
  Grid --> Customer : seats: available / selected / locked / booked
end
Customer -> Grid : click seat
Grid -> Page : onSeatClick(seat)
Page -> Page : strategy.onSeatClick(seat, ctx)\n(ManualSelectionStrategy | ContiguousBlockStrategy)
note over Page : Selection is local UI state only -\nthe server re-validates when seats are held.
Page -> Poller : stop() on unmount
@enduml
```

## C4. Sequence - Successful booking (seat hold)

One transaction: advisory lock for idempotency → row-lock seats → reclaim expired holds → price → build draft → insert header → claim seats → insert lines → COMMIT.

**Code:** `services/BookingService.ts#createHold`, `services/SeatLockService.ts#hold`, `concurrency/SeatLockingStrategy.ts`, `repositories/pg/PgShowSeatRepository.ts`, `PgBookingRepository.ts`

```plantuml
@startuml seq-04-successful-booking
title Sequence 4 - Successful seat hold (POST /api/bookings, pessimistic strategy)
autonumber
actor Customer
participant SeatSelectionPage as Page
participant "authenticate +\nvalidate(HoldBody)" as MW
participant BookingController as Ctrl
participant BookingService as BS
participant PgUnitOfWorkFactory as UoWF
participant TransactionManager as TM
participant PgAdvisoryLockRepository as Adv
participant PgBookingRepository as Bookings
participant PgShowRepository as Shows
participant SeatLockService as SLS
participant PessimisticSeatLockingStrategy as Strat
participant PgShowSeatRepository as Seats
participant "PriceCalculator\n(decorator chain)" as Price
participant BookingBuilder as Builder
database PostgreSQL as DB

Customer -> Page : "Hold N seats & continue"
Page -> MW : POST /api/bookings {showId, seatIds}\nIdempotency-Key: hold-...
MW -> MW : AuthService.authenticate(token)\nHoldBody.parse(body)
MW -> Ctrl : createHold(req, res)
Ctrl -> BS : createHold(user, {showId, seatIds}, key)
BS -> BS : reject duplicate seats / > maxSeatsPerBooking
BS -> UoWF : transaction(work)
UoWF -> TM : run(work)
TM -> DB : BEGIN ISOLATION LEVEL READ COMMITTED
BS -> Adv : lockForTransaction("hold:user:key")
Adv -> DB : SELECT pg_advisory_xact_lock(hashtextextended(...))
BS -> Bookings : findByUserAndIdempotencyKey(userId, key)
Bookings --> BS : null (first attempt)
BS -> Shows : findById(showId)
BS -> BS : show.isBookableAt(now)
BS -> SLS : hold(uow, {showId, seatIds, now, buildDraft})
SLS -> Strat : reserveCandidates(uow, showId, seatIds, now)
Strat -> Seats : findByShowAndSeatIds(showId, seatIds, {forUpdate: true})
Seats -> DB : SELECT ... ORDER BY ss.id FOR UPDATE OF ss
DB --> Seats : rows (row locks held until COMMIT)
Strat -> Strat : all exist? all isAvailableAt(now)?
Strat --> SLS : ShowSeat[]
SLS -> SLS : reclaimExpiredHolds(uow, seats, now)\n(none expired here)
SLS -> BS : buildDraft(seats)
BS -> Price : calculate({show, seats})
Price --> BS : PriceQuote {seatPrices, subtotal, lines, total}
BS -> Builder : forUser().forShow().withPricing()\n.withIdempotencyKey().holdUntil().withSeat()*
Builder --> BS : build(): BookingDraft
BS --> SLS : BookingDraft
SLS -> Bookings : createHeader(draft)
Bookings -> DB : INSERT INTO bookings (status 'PENDING', expires_at)
SLS -> Strat : claim(uow, seats, bookingId, expiresAt)
Strat -> Seats : lockSeats(ids, bookingId, expiresAt)
Seats -> DB : UPDATE show_seats SET status='LOCKED', version=version+1
SLS -> Bookings : addLines(bookingId, draft.seats)
Bookings -> DB : INSERT INTO booking_seats\n(guarded by ux_booking_seats_one_active_per_show_seat)
SLS -> Bookings : findById(bookingId)
SLS --> BS : Booking (PENDING)
TM -> DB : COMMIT (row locks released)
BS -> Bookings : findSummary(bookingId)
BS --> Ctrl : {booking: BookingView, replayed: false}
Ctrl --> Page : 201 Created
Page --> Customer : navigate /checkout/:id (countdown starts)

note over BS, DB
  Same Idempotency-Key again -> the advisory lock serialises the retry,
  findByUserAndIdempotencyKey() returns the existing booking -> 200 (replayed).
end note
@enduml
```

## C5. Sequence - Concurrent booking attempts

Two users race for one seat. With `FOR UPDATE` the loser blocks, then re-reads the committed LOCKED row and gets 409; the optimistic variant fails its version compare-and-set. The partial unique index is the final guard.

**Code:** `concurrency/SeatLockingStrategy.ts`, `db/migrations/001_initial_schema.sql`, `tests/concurrency/booking-concurrency.test.ts`

```plantuml
@startuml seq-05-concurrent-booking
title Sequence 5 - Concurrent booking attempts for the same seat (A1, show S1)
autonumber
actor "User A" as UA
actor "User B" as UB
participant "BookingService\n(request A)" as BSA
participant "BookingService\n(request B)" as BSB
participant SeatLockService as SLS
participant PessimisticSeatLockingStrategy as Strat
participant PgShowSeatRepository as Seats
database PostgreSQL as DB

par simultaneous requests
  UA -> BSA : POST /api/bookings {S1, [A1]}
else
  UB -> BSB : POST /api/bookings {S1, [A1]}
end

BSA -> DB : BEGIN (txn A)
BSB -> DB : BEGIN (txn B)
BSA -> SLS : hold(uowA, ...)
SLS -> Strat : reserveCandidates(uowA, S1, [A1], now)
Strat -> Seats : findByShowAndSeatIds(..., {forUpdate: true})
Seats -> DB : SELECT ... FOR UPDATE OF ss (txn A)
DB --> Seats : A1 AVAILABLE - row lock granted to A

BSB -> SLS : hold(uowB, ...)
SLS -> Strat : reserveCandidates(uowB, S1, [A1], now)
Strat -> Seats : findByShowAndSeatIds(..., {forUpdate: true})
Seats -> DB : SELECT ... FOR UPDATE OF ss (txn B)
activate DB #FFCCCC
note right of DB : txn B BLOCKS on A1's row lock

SLS -> DB : bookings.createHeader / Strat.claim -> showSeats.lockSeats / bookings.addLines (txn A)
note right of SLS : INSERT booking, UPDATE A1 -> LOCKED, INSERT booking_seats line
BSA -> DB : COMMIT (txn A) - lock released
BSA --> UA : 201 Created (hold acquired)

DB --> Seats : txn B wakes up and re-reads the COMMITTED row:\nA1 is LOCKED by booking of A
deactivate DB
Seats --> Strat : ShowSeat(A1, LOCKED)
Strat -> Strat : isAvailableAt(now) == false
Strat --> BSB : throw SeatUnavailableError([A1])
BSB -> DB : ROLLBACK (txn B) - nothing persisted
BSB --> UB : 409 SEAT_UNAVAILABLE

alt SEAT_LOCK_STRATEGY = OPTIMISTIC
  note over Strat, DB
    Both transactions read A1 (version v) WITHOUT locks.
    Both run UPDATE show_seats ... WHERE id = A1 AND version = v.
    B's UPDATE waits for A's row lock; after A commits PostgreSQL re-checks
    the WHERE clause: version is now v+1 -> 0 rows updated.
    OptimisticSeatLockingStrategy.claim() sees updated < requested
    -> SeatUnavailableError -> ROLLBACK -> 409.
  end note
end

note over BSA, DB
  Last line of defence (both strategies): partial unique index
  ux_booking_seats_one_active_per_show_seat ON booking_seats(show_seat_id) WHERE is_active.
  A second active line raises SQLSTATE 23505, mapped to SeatUnavailableError (409).
  Verified by tests/concurrency/booking-concurrency.test.ts with 50 simultaneous requests.
end note
@enduml
```

## C6. Sequence - Booking conflict in the UI

How the frontend reacts to a 409: keep the server message, `poller.refresh()`, prune the selection, re-render.

**Code:** `frontend/src/pages/SeatSelectionPage.tsx`, `api/httpClient.ts`

```plantuml
@startuml seq-06-booking-conflict
title Sequence 6 - Booking conflict handled in the UI (user loses the race)
autonumber
actor "User B" as UB
participant SeatSelectionPage as Page
participant "api.bookings.hold\n(HttpClient)" as Http
participant BookingController as Ctrl
participant BookingService as BS
participant SeatAvailabilityPoller as Poller
participant "SeatMap\n(component)" as Grid

UB -> Page : selects A1 (still shown as available)
UB -> Page : click "Hold 1 seat & continue"
Page -> Page : holdKey.current ??= newIdempotencyKey('hold')
Page -> Http : hold(showId, [A1], holdKey)
Http -> Ctrl : POST /api/bookings
Ctrl -> BS : createHold(user, input, key)
BS --> Ctrl : throw SeatUnavailableError
Ctrl --> Http : 409 {code: SEAT_UNAVAILABLE, details: {seatIds}}
Http --> Page : throw ApiError(409) (isConflict = true)
Page -> Page : setConflict(err.message + "seat map refreshed")
Page -> Poller : refresh()
Poller -> Http : api.shows.seats(showId)
Http --> Poller : fresh SeatMap (A1 = LOCKED)
Poller --> Page : notify(state)
Page -> Page : pruneUnavailable(selected, seatMap)\n-> A1 removed from selection
note right of Page
  The conflict message from the server is kept
  (setConflict(c => c ?? ...)) so the user sees why.
end note
Page -> Grid : render(seatMap, selected = [])
Grid --> UB : A1 shown as "Held by others" (disabled)
UB -> Grid : choose another seat and retry
@enduml
```

## C7. Sequence - Payment success

Lock order seats → booking, idempotent replay check, Strategy (`CardPaymentStrategy`) → Adapter (`LegacyPayGatewayAdapter`) → simulated SDK, seats BOOKED, booking CONFIRMED, COMMIT, then Observer notifications.

**Code:** `services/BookingService.ts#pay`, `payments/*`, `notifications/*`

```plantuml
@startuml seq-07-payment-success
title Sequence 7 - Payment success (POST /api/bookings/:id/payments)
autonumber
actor Customer
participant CheckoutPage as Page
participant "PaymentFormFactory\n(card strategy)" as Form
participant BookingController as Ctrl
participant BookingService as BS
participant TransactionManager as TM
participant SeatLockService as SLS
participant PgShowSeatRepository as Seats
participant PgBookingRepository as Bookings
participant PgPaymentRepository as Payments
participant PaymentService as PS
participant PaymentStrategyFactory as PSF
participant CardPaymentStrategy as Card
participant LegacyPayGatewayAdapter as Adapter
participant LegacyPaySdk as SDK
participant BookingEventPublisher as Pub
participant NotificationService as Notif
database PostgreSQL as DB

Customer -> Page : fill card details, click Pay
Page -> Form : validate(values)  (UX only)
Page -> Ctrl : POST /bookings/:id/payments {method: CARD, details}\nIdempotency-Key: pay-...
Ctrl -> BS : pay(user, bookingId, {method, details}, key)
BS -> TM : transaction(work) -> BEGIN
BS -> SLS : lockBookingForUpdate(uow, bookingId)
SLS -> Bookings : findById(bookingId) (snapshot of active lines)
SLS -> Seats : findByIds(showSeatIds, {forUpdate: true})
Seats -> DB : SELECT ... ORDER BY ss.id FOR UPDATE OF ss
SLS -> Bookings : findById(bookingId, {forUpdate: true})
Bookings -> DB : SELECT * FROM bookings ... FOR UPDATE
SLS --> BS : {booking, seats}
BS -> BS : authorize(user, booking)
BS -> Payments : findByBookingAndKey(bookingId, key)
Payments --> BS : null (not a replay)
BS -> BS : booking.isHoldExpired(now) == false\nbooking.assertPayable(now)
BS -> SLS : assertStillHeld(booking, seats, now)
BS -> PS : charge(CARD, totalAmount, reference, details)
PS -> PSF : get(CARD)
PSF --> PS : CardPaymentStrategy
PS -> Card : pay({amount, bookingReference, details})
Card -> Card : validate(details) / tokenise() / mask()
Card -> Adapter : charge({amount, instrumentType: CARD, token, reference})
Adapter -> SDK : makeTransaction({amount_paise, 'CC', ...}, callback)
SDK --> Adapter : callback(null, {code: '00', txn_id})
Adapter --> Card : GatewayResult {approved: true, transactionRef}
Card --> PS : PaymentResult {success: true}
PS --> BS : PaymentResult
BS -> Payments : create({status: SUCCESS, transactionRef, idempotencyKey})
BS -> SLS : confirmSeats(uow, booking, seats, now)
SLS -> SLS : seat.book(bookingId, now) for each
SLS -> Seats : markBooked(ids, bookingId)
Seats -> DB : UPDATE show_seats SET status='BOOKED' WHERE status='LOCKED' AND booking_id=$2
BS -> BS : booking.confirm(now)
BS -> Bookings : save(booking)
TM -> DB : COMMIT
BS -> Pub : publish(BOOKING_CONFIRMED)  (after commit)
Pub -> Notif : handle(event)
Notif -> DB : INSERT notifications (EMAIL, SMS)
BS -> Bookings : findSummary(bookingId)
BS --> Ctrl : BookingView (CONFIRMED)
Ctrl --> Page : 200
Page --> Customer : /bookings/:id/confirmation (ticket)
@enduml
```

## C8. Sequence - Payment failure

A *decline* is a business outcome and is committed (payment FAILED, booking FAILED, seats released, 402). A *gateway outage* is an exception → ROLLBACK → hold intact, retry possible. An expired hold yields 410.

**Code:** `services/BookingService.ts#pay`, `payments/gateway/LegacyPaySdk.ts` (simulation rules), `tests/integration/bookings.test.ts`

```plantuml
@startuml seq-08-payment-failure
title Sequence 8 - Payment failure: decline (committed) vs gateway outage (rolled back)
autonumber
actor Customer
participant CheckoutPage as Page
participant BookingService as BS
participant TransactionManager as TM
participant SeatLockService as SLS
participant PaymentService as PS
participant UpiPaymentStrategy as Strategy
participant LegacyPayGatewayAdapter as Adapter
participant PgPaymentRepository as Payments
participant PgBookingRepository as Bookings
participant PgShowSeatRepository as Seats
participant BookingEventPublisher as Pub
database PostgreSQL as DB

Customer -> Page : Pay (e.g. UPI "fail@bank" or card ...9999)
Page -> BS : pay(user, bookingId, {method, details}, key)
BS -> TM : BEGIN
BS -> SLS : lockBookingForUpdate(uow, bookingId)
BS -> BS : assertPayable(now), assertStillHeld(...)
BS -> PS : charge(method, amount, reference, details)
PS -> Strategy : pay(request)
Strategy -> Adapter : charge(...)

alt DECLINED (business outcome)
  Adapter --> Strategy : {approved: false, message}
  Strategy --> PS : PaymentResult {success: false, failureReason}
  PS --> BS : PaymentResult
  BS -> Payments : create({status: FAILED, failureReason})
  BS -> BS : booking.markPaymentFailed()  (lines -> inactive)
  BS -> Bookings : save(booking)  (status FAILED)
  BS -> SLS : releaseSeats(uow, booking)
  SLS -> Seats : releaseForBooking(bookingId)
  Seats -> DB : UPDATE show_seats SET status='AVAILABLE', booking_id=NULL
  TM -> DB : COMMIT
  BS -> Pub : publish(PAYMENT_FAILED)
  BS --> Page : throw PaymentFailedError -> 402 PAYMENT_FAILED\n(details.booking.status = FAILED)
  Page --> Customer : "Payment failed - seats released", "Choose seats again"
else GATEWAY OUTAGE (infrastructure failure)
  Adapter --> Strategy : reject GatewayUnavailableError
  Strategy --> PS : rejects
  PS --> BS : rejects
  BS -> TM : exception propagates
  TM -> DB : ROLLBACK
  note right of DB
    Nothing persisted: no payment row,
    booking stays PENDING, seats stay LOCKED.
    The hold survives and the user may retry.
  end note
  BS --> Page : 500 INTERNAL_ERROR
  Page --> Customer : error message; retry allowed
else HOLD EXPIRED before payment
  BS -> SLS : expireHold(uow, booking)
  TM -> DB : COMMIT (booking EXPIRED, seats AVAILABLE)
  BS --> Page : 410 HOLD_EXPIRED
end
@enduml
```

## C9. Sequence - Booking cancellation

Business rules live in `Booking.cancel`: pending holds release freely; confirmed bookings refund only ≥ cut-off minutes before the show; otherwise 422/409 and ROLLBACK.

**Code:** `domain/Booking.ts#cancel`, `services/BookingService.ts#cancel`, `frontend/src/pages/BookingPages.tsx`

```plantuml
@startuml seq-09-cancellation
title Sequence 9 - Booking cancellation (POST /api/bookings/:id/cancel)
autonumber
actor Customer
participant BookingHistoryPage as Page
participant BookingController as Ctrl
participant BookingService as BS
participant TransactionManager as TM
participant SeatLockService as SLS
participant "Booking\n(aggregate)" as Agg
participant PgShowRepository as Shows
participant PgPaymentRepository as Payments
participant PaymentService as PS
participant CardPaymentStrategy as Strategy
participant LegacyPayGatewayAdapter as Adapter
participant PgBookingRepository as Bookings
participant PgShowSeatRepository as Seats
participant BookingEventPublisher as Pub
database PostgreSQL as DB

Customer -> Page : "Cancel booking" (confirm dialog)
Page -> Ctrl : POST /api/bookings/:id/cancel
Ctrl -> BS : cancel(user, bookingId)
BS -> TM : BEGIN
BS -> SLS : lockBookingForUpdate(uow, bookingId)
SLS -> DB : SELECT show_seats FOR UPDATE, then bookings FOR UPDATE
BS -> BS : authorize(user, booking)  (403 if not owner/admin)
BS -> Shows : findById(booking.showId)
BS -> Agg : cancel(now, show, cancellationCutoffMinutes)
alt PENDING hold
  Agg --> BS : {refundRequired: false}
else CONFIRMED and minutesUntilStart >= cutoff
  Agg --> BS : {refundRequired: true}
  BS -> Payments : findSuccessfulByBooking(bookingId)
  BS -> PS : refund(method, transactionRef, amount)
  PS -> Strategy : refund(transactionRef, amount)
  Strategy -> Adapter : refund(transactionRef, amount)
  Adapter --> Strategy : {approved: true}
  BS -> BS : payment.markRefunded(now)
  BS -> Payments : save(payment)  (status REFUNDED)
else CONFIRMED inside cut-off window
  Agg --> BS : throw BusinessRuleError(CANCELLATION_WINDOW_CLOSED)
  TM -> DB : ROLLBACK
  BS --> Page : 422
else already CANCELLED / EXPIRED / FAILED
  Agg --> BS : throw ConflictError
  TM -> DB : ROLLBACK
  BS --> Page : 409
end
BS -> Bookings : save(booking)  (CANCELLED, lines inactive)
BS -> SLS : releaseSeats(uow, booking)
SLS -> Seats : releaseForBooking(bookingId)
TM -> DB : COMMIT
BS -> Pub : publish(BOOKING_CANCELLED)  (after commit)
BS --> Ctrl : BookingView (CANCELLED, paymentStatus REFUNDED)
Ctrl --> Page : 200
Page --> Customer : "Booking cancelled. Refund initiated."
@enduml
```

## D. Activity Diagram - Complete booking workflow

Selection → hold (validation, idempotency, locking, reclaim, conflict loop) → checkout countdown in parallel with the expiry sweeper → payment (expiry, invalid state, outage/rollback/retry, approve vs decline) → optional cancellation with refund.

**Code:** `services/BookingService.ts`, `services/SeatLockService.ts`, `services/HoldExpiryJob.ts`, `frontend/src/pages/*`

```plantuml
@startuml activity-booking
title Activity - Complete booking workflow
start
:Customer opens seat map (/shows/:id);
:SeatAvailabilityPoller polls GET /shows/:id/seats every 5 s;
repeat
  :Select seats (Manual or ContiguousBlock strategy);
  :Click "Hold seats";
  if (Logged in?) then (no)
    :Redirect to /login, then back;
  endif
  partition "POST /api/bookings (one DB transaction)" {
    :Validate request (zod HoldBody, duplicates, max seats);
    if (Idempotency-Key already used by this user?) then (yes)
      :Return existing booking (200 replayed);
      detach
    endif
    :Check show is SCHEDULED and not started;
    :Lock seat rows (SELECT ... FOR UPDATE)\nor read versions (optimistic);
    if (All seats exist?) then (no)
      :404 NOT_FOUND;
      stop
    endif
    if (Every seat AVAILABLE or lock expired?) then (no)
      :ROLLBACK;
      :409 SEAT_UNAVAILABLE;
    else (yes)
      :Re-claim expired locks\n(deactivate old lines, mark old booking EXPIRED);
      :Price seats (strategy + decorators);
      :Build BookingDraft (BookingBuilder);
      :INSERT booking (PENDING, expires_at = now + hold);
      :Seats -> LOCKED (claim);
      :INSERT booking_seats (unique active index);
      :COMMIT;
    endif
  }
  backward :UI refreshes seat map,\nprunes taken seats;
repeat while (Hold acquired?) is (no) not (yes)

:Checkout page shows price breakdown + countdown;
fork
  :Customer fills payment form;
fork again
  :HoldExpiryJob runs every 30 s;
  if (Hold expired and still PENDING?) then (yes)
    :Booking EXPIRED, seats AVAILABLE,\nBOOKING_EXPIRED notification;
  endif
end fork

if (Customer releases seats?) then (yes)
  :POST /bookings/:id/cancel -> CANCELLED, seats AVAILABLE;
  stop
endif

repeat
  partition "POST /api/bookings/:id/payments (one DB transaction)" {
    :Lock booking's seats FOR UPDATE, then booking FOR UPDATE;
    if (Same Idempotency-Key already paid?) then (yes)
      :Return original result;
      stop
    endif
    if (Hold expired?) then (yes)
      :Expire booking, release seats, COMMIT;
      :410 HOLD_EXPIRED -> choose seats again;
      stop
    endif
    if (Booking payable and seats still held?) then (no)
      :ROLLBACK;
      :409 already paid / invalid state;
      stop
    endif
    :PaymentService.charge() -> strategy -> adapter -> gateway;
  }
  if (Gateway reachable?) then (no)
    :Exception -> ROLLBACK\n(hold untouched, nothing persisted);
    :500 - user may retry;
  endif
repeat while (Retry after outage?) is (yes) not (no / answered)

if (Approved?) then (yes)
  :Payment SUCCESS;
  :Seats LOCKED -> BOOKED;
  :Booking PENDING -> CONFIRMED;
  :COMMIT;
  :Publish BOOKING_CONFIRMED\n(e-mail + SMS notification);
  :Show confirmation ticket;
  if (Customer cancels later?) then (yes)
    if (>= cut-off before show start?) then (yes)
      :Refund via payment strategy;
      :Payment REFUNDED, booking CANCELLED,\nseats AVAILABLE, COMMIT;
      :Publish BOOKING_CANCELLED;
    else (no)
      :422 CANCELLATION_WINDOW_CLOSED;
    endif
  endif
else (declined)
  :Payment FAILED;
  :Booking FAILED, seats released;
  :COMMIT;
  :Publish PAYMENT_FAILED;
  :402 PAYMENT_FAILED -> choose seats again;
endif
stop
@enduml
```

