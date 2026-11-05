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
    expected_version: int = Field(ge=1)
    note: str = Field(min_length=5, max_length=2000)
    extraction: InvoiceExtraction

class RetryRequest(StrictModel):
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
