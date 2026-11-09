from decimal import Decimal
from typing import Generic, Literal, TypeVar
from pydantic import BaseModel, ConfigDict, Field

T = TypeVar('T')

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class ExtractedField(StrictModel, Generic[T]):
    value: T | None
    confidence: Literal['high', 'medium', 'low']
    evidence: str | None
    page: int | None = Field(ge=1)

class LineItem(StrictModel):
    description: ExtractedField[str]
    quantity: ExtractedField[Decimal]
    unit_price: ExtractedField[Decimal]
    amount: ExtractedField[Decimal]

class TaxComponent(StrictModel):
    name: str
    rate: Decimal
    amount: Decimal

class InvoiceExtraction(StrictModel):
    document_type: ExtractedField[str]
    original_invoice: ExtractedField[str]
    vendor_name: ExtractedField[str]
    invoice_number: ExtractedField[str]
    invoice_date: ExtractedField[str]
    due_date: ExtractedField[str]
    currency: ExtractedField[str]
    po_reference: ExtractedField[str]
    line_items: list[LineItem]
    subtotal: ExtractedField[Decimal]
    tax: ExtractedField[Decimal]
    total_amount: ExtractedField[Decimal]
    bank_details: ExtractedField[str]
    tax_profile: ExtractedField[str]
    tax_rate: ExtractedField[Decimal]
    supplier_state: ExtractedField[str]
    place_of_supply: ExtractedField[str]
    tax_components: ExtractedField[list[TaxComponent]]

class ExtractionBatch(StrictModel):
    # The 30-document cap is still enforced on validation, but omitted from the
    # JSON schema: Gemini's OpenAI-compatible structured output rejects maxItems.
    documents: list[InvoiceExtraction] = Field(min_length=1, max_length=30,
                                               json_schema_extra=lambda s: s.pop('maxItems', None))

class Correction(StrictModel):
    reviewer: str = Field(min_length=2, max_length=80, pattern=r'\S')  # who is acting, shown in audit and export
    expected_version: int = Field(ge=1)
    note: str = Field(min_length=5, max_length=2000)
    extraction: InvoiceExtraction

class ManualApproval(StrictModel):
    reviewer: str = Field(min_length=2, max_length=80, pattern=r'\S')  # who is acting, shown in audit and export
    expected_version: int = Field(ge=1)
    note: str = Field(min_length=10, max_length=2000)
    # Every open reason code must be acknowledged, so no issue is approved unseen.
    acknowledged_codes: list[str]

class RetryRequest(StrictModel):
    reviewer: str = Field(min_length=2, max_length=80, pattern=r'\S')  # who is acting, shown in audit and export
    expected_version: int = Field(ge=1)
    note: str = Field(min_length=5, max_length=2000)

class IngestRequest(StrictModel):
    email_id: int = Field(gt=0)

Status = Literal['queued', 'processing', 'review', 'approved', 'duplicate']

class Finding(StrictModel):
    code: str
    message: str
    stage: str
    field: str | None

class Decision(StrictModel):
    outcome: Literal['review', 'approved', 'duplicate']
    reason_codes: list[str]
    explanation: str
    # True when a reviewer approved despite open findings (reason_codes lists them).
    manual_override: bool = False

class CaseSummary(StrictModel):
    id: str
    email_id: int | None
    hash: str
    sender: str
    filename: str
    status: Status
    version: int
    created_at: str
    updated_at: str
    findings: list[Finding]
    decision: Decision | None
    po_number: str | None
    vendor_id: str | None
    invoice_number: str | None
    amount: str | None
    currency: str | None
    invoice_date: str | None
    model: str | None

class CaseDetail(CaseSummary):
    pages: list[dict] | None
    extraction: InvoiceExtraction | ExtractionBatch | None
    checks: dict
    policy_snapshot: dict | None

class CasePage(StrictModel):
    items: list[CaseSummary]
    total: int
    limit: int
    offset: int

class IngestResult(StrictModel):
    id: str
    duplicate_submission: bool
    status: Status


class PurchaseOrderInput(BaseModel):
    """One PO as typed in the form or read from a CSV row. Values are checked row by row by the service."""
    model_config = ConfigDict(extra='allow')
    number: str | None = None
    vendor_id: str | None = None
    currency: str | None = None
    amount: str | float | None = None
    received_amount: str | float | None = None
    previously_invoiced: str | float | None = None
    tolerance_percent: str | float | None = None
    issue_date: str | None = None

class PurchaseOrderUpload(StrictModel):
    reviewer: str = Field(min_length=2, max_length=80, pattern=r'\S')  # recorded as uploaded_by
    items: list[PurchaseOrderInput] = Field(min_length=1, max_length=1000)
    dry_run: bool = False  # true: only check the rows, save nothing

class PurchaseOrderRowResult(BaseModel):
    row: int
    number: str | None
    errors: list[str]

class PurchaseOrderUploadResult(BaseModel):
    saved: bool    # true when the POs were stored
    valid: bool    # true when every row passed the checks
    added: int
    rows: list[PurchaseOrderRowResult]


class Money(BaseModel):
    currency: str
    amount: str  # exact decimal string

class StatsTotals(BaseModel):
    cases: int
    by_status: dict[str, int]
    finished: int                         # approved + review + duplicate
    approved_automatic: int
    approved_manual: int
    approval_rate: float | None           # approved / finished, 0..1
    straight_through_rate: float | None   # approved without a person / finished
    cases_with_problems: int
    cases_with_invoice_problems: int      # excludes OCR/model failures
    cases_with_processing_problems: int
    vendors: int
    approved_value: list[Money]
    held_value: list[Money]

class VendorProblem(BaseModel):
    code: str
    cases: int

class VendorStats(BaseModel):
    key: str                  # vendor ID, "name:<printed name>" for vendors not in the master, or "unidentified"
    vendor_id: str | None
    name: str
    in_master: bool
    cases: int
    approved: int
    approved_manual: int
    review: int
    duplicate: int
    in_progress: int
    problem_cases: int        # cases with at least one invoice problem
    problem_rate: float | None
    approval_rate: float | None
    problem_occurrences: int
    problems: list[VendorProblem]
    top_problems: list[str]   # every code tied for most cases
    top_problem_cases: int
    approved_value: list[Money]

class ProblemVendor(BaseModel):
    key: str
    name: str
    cases: int

class ProblemField(BaseModel):
    field: str
    cases: int

class ProblemStats(BaseModel):
    code: str
    category: Literal['invoice', 'processing']
    cases: int
    share_of_cases: float | None
    vendors: list[ProblemVendor]
    fields: list[ProblemField]

class StatsHighlights(BaseModel):
    most_problematic_vendors: list[str]   # vendor keys; more than one only on an exact tie
    most_common_problems: list[str]       # invoice problem codes; more than one only on a tie

class Statistics(BaseModel):
    generated_at: str
    totals: StatsTotals
    vendors: list[VendorStats]
    problems: list[ProblemStats]
    highlights: StatsHighlights
