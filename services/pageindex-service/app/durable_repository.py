"""PostgREST aggregate storage. No cache or filesystem fallback on DB errors."""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .models import DocumentRecord, IndexDocument, JobRecord, ValidationReport


class RepositoryUnavailable(RuntimeError):
    pass


class RevisionConflict(RuntimeError):
    pass


class SupabaseRepository:
    def __init__(self, url: str, key: str, seed_root: str | Path):
        if not url or not key or key == '[SENSITIVE]':
            raise RuntimeError('Supabase repository configuration is required')
        self.url = url.rstrip('/') + '/rest/v1/'
        self.key = key
        self.seed_root = Path(seed_root)

    def _request(self, path, body=None):
        request = Request(self.url + path,
                          data=json.dumps(body).encode() if body is not None else None,
                          headers={'apikey': self.key, 'Authorization': 'Bearer ' + self.key,
                                   'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=45) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code == 409:
                raise RevisionConflict('pageindex_revision_conflict') from None
            # Never include response bodies, URLs or credentials in errors.
            raise RepositoryUnavailable('pageindex_storage_unavailable') from None
        except (URLError, TimeoutError, ValueError, OSError):
            raise RepositoryUnavailable('pageindex_storage_unavailable') from None

    def _seed(self, document_id, folder, model):
        # Only explicit bundled public documents can fall back. Arbitrary IDs
        # never become paths; old private /tmp records are never consulted.
        if document_id not in {'textbook', 'teacher-guide', 'curriculum-standard'}:
            return None
        path = self.seed_root / folder / f'{document_id}.json'
        return model.model_validate_json(path.read_text()) if path.is_file() else None

    def snapshot(self, document_id, expected_revision=None):
        rows = self._request('pageindex_documents?' + urlencode({'document_id': 'eq.' + document_id, 'select': '*'}))
        row = rows[0] if rows else {
            'document_id': document_id, 'revision': 0, 'deleted': False,
            **{field: (value.model_dump(by_alias=True, mode='json') if value else None)
               for field, value in (
                   ('document', self._seed(document_id, 'documents', DocumentRecord)),
                   ('index_data', self._seed(document_id, 'indexes', IndexDocument)),
                   ('validation', self._seed(document_id, 'validations', ValidationReport)))}}
        if expected_revision is not None and row['revision'] != expected_revision:
            raise RevisionConflict('pageindex_revision_conflict')
        return Aggregate(self, row)

    def get_document(self, document_id):
        return self.snapshot(document_id).get_document(document_id)

    def get_index(self, document_id):
        return self.snapshot(document_id).get_index(document_id)

    def get_validation(self, document_id):
        return self.snapshot(document_id).get_validation(document_id)

    def get_job(self, job_id):
        rows = self._request('pageindex_jobs?' + urlencode({'job_id': 'eq.' + job_id, 'select': 'job'}))
        return JobRecord.model_validate(rows[0]['job']) if rows else None

    def list_documents(self):
        rows = self._request('pageindex_documents?select=document_id,document,deleted&order=document_id')
        records = {row['document_id']: None if row['deleted'] else DocumentRecord.model_validate(row['document']) for row in rows}
        for document_id in ('textbook', 'teacher-guide', 'curriculum-standard'):
            if document_id not in records:
                records[document_id] = self._seed(document_id, 'documents', DocumentRecord)
        return [value for value in records.values() if value]

    def list_indexes(self):
        return [index for document in self.list_documents() if (index := self.get_index(document.id))]


class Aggregate:
    """One request's snapshot and staged writes; never shared between requests."""
    def __init__(self, parent, row):
        self.parent = parent
        self.row = deepcopy(row)
        self.revision = row['revision']
        self.document_id = row['document_id']
        self.jobs = {}
        self.dirty = False

    def _read(self, document_id, field, model):
        if document_id != self.document_id:
            raise ValueError('aggregate document mismatch')
        value = self.row.get(field)
        return model.model_validate(deepcopy(value)) if value and not self.row['deleted'] else None

    def _save(self, document_id, field, value):
        if document_id != self.document_id:
            raise ValueError('aggregate document mismatch')
        self.row[field] = value.model_dump(by_alias=True, mode='json')
        self.row['deleted'] = False
        self.dirty = True

    def get_document(self, document_id):
        return self._read(document_id, 'document', DocumentRecord)

    def save_document(self, document):
        self._save(document.id, 'document', document)

    def get_index(self, document_id):
        return self._read(document_id, 'index_data', IndexDocument)

    def save_index(self, index):
        self._save(index.document_id, 'index_data', index)
        self.row['validation'] = None  # A changed index invalidates old quality results.

    def get_validation(self, document_id):
        return self._read(document_id, 'validation', ValidationReport)

    def save_validation(self, report):
        self._save(report.document_id, 'validation', report)

    def save_job(self, job):
        if job.document_id != self.document_id:
            raise ValueError('aggregate job mismatch')
        self.jobs[job.job_id] = job.model_dump(by_alias=True, mode='json')
        self.dirty = True

    def get_job(self, job_id):
        value = self.jobs.get(job_id)
        return JobRecord.model_validate(value) if value else self.parent.get_job(job_id)

    def delete_document(self, document_id):
        if not self.get_document(document_id):
            return False
        self.row.update(document=None, index_data=None, validation=None, deleted=True)
        self.dirty = True
        return True

    def commit(self):
        if self.dirty:
            self.revision = self.parent._request('rpc/pageindex_commit', {
                'p_document_id': self.document_id, 'p_expected_revision': self.revision,
                'p_document': self.row.get('document'), 'p_index_data': self.row.get('index_data'),
                'p_validation': self.row.get('validation'), 'p_jobs': list(self.jobs.values()),
                'p_deleted': self.row['deleted']})
        return self.revision
