import React, { useState } from 'react';

const ObjectReconciliationTool = () => {

  const [sourceFile, setSourceFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [objectDefinition, setObjectDefinition] = useState('');
  const [reconciliationResult, setReconciliationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [availableFields, setAvailableFields] = useState([]);


  const [showBatchSection, setShowBatchSection] = useState(false);
  const [batchMode, setBatchMode] = useState('all'); // 'all' | 'batch'
  const [batchField, setBatchField] = useState('');
  const [batchValue, setBatchValue] = useState('');
  const [filteringMethod, setFilteringMethod] = useState(null);


  React.useEffect(() => {
    if (typeof Liferay === 'undefined') {
      console.warn('Liferay global object not found. API calls may fail.');
    } else {
      console.log('Liferay detected:', Liferay.ThemeDisplay?.getLayoutRelativeURL());
    }
  }, []);


  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',').map(v => v.trim());
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] || '';
      });
      records.push(record);
    }

    return { headers, records };
  };


  const isNumericValue = (value) => {
    if (!value) return false;
    const trimmed = String(value).trim();
    return !isNaN(trimmed) && !isNaN(parseFloat(trimmed));
  };


  const buildFilterString = (field, value) => {
    return isNumericValue(value)
      ? `${field} eq ${value}`
      : `${field} eq '${value}'`;
  };


  const filterRecordsByBatch = (records, field, value) => {
    if (!field || !value) return records;
    const search = String(value).trim().toLowerCase();
    return records.filter(r => String(r[field] || '').trim().toLowerCase() === search);
  };


  const fetchLiferayObjectData = async (objectName, batchFilter = null) => {
    try {
      let allItems = [];
      let page = 1;
      let hasMore = true;
      const pageSize = 100;
      let usedServerFilter = false;
      let resolvedFilteringMethod = null;

      const authToken =
        typeof Liferay !== 'undefined' && Liferay.authToken
          ? Liferay.authToken
          : '';

      const buildHeaders = () => {
        const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (authToken) h['x-csrf-token'] = authToken;
        return h;
      };

      
      if (batchFilter) {
        try {
          const filterString = buildFilterString(batchFilter.field, batchFilter.value);
          console.log('Attempting server-side filter:', filterString);

          while (hasMore) {
            const url = `/o/c/${objectName}/?page=${page}&pageSize=${pageSize}&filter=${encodeURIComponent(filterString)}`;
            const response = await fetch(url, {
              method: 'GET',
              headers: buildHeaders(),
              credentials: 'same-origin',
            });

            if (!response.ok) {
              throw new Error(`Server filter rejected (${response.status})`);
            }

            const data = await response.json();
            const items = data.items || [];
            allItems = [...allItems, ...items];
            hasMore = items.length === pageSize && data.totalCount > allItems.length;
            page++;
          }

          usedServerFilter = true;
          resolvedFilteringMethod = 'server';
          console.log('✓ Server-side filter succeeded. Items:', allItems.length);

        } catch (serverErr) {
          console.warn('⚠ Server-side filter failed:', serverErr.message);
          console.log('→ Falling back to client-side filtering...');
          allItems = [];
          page = 1;
          hasMore = true;
        }
      }

     
      if (!usedServerFilter) {
        while (hasMore) {
          const url = `/o/c/${objectName}/?page=${page}&pageSize=${pageSize}`;
          const response = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(),
            credentials: 'same-origin',
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(
              `Failed to fetch Object data (${response.status}): ${response.statusText}. ${errText}`
            );
          }

          const data = await response.json();
          const items = data.items || [];
          allItems = [...allItems, ...items];
          hasMore = items.length === pageSize && data.totalCount > allItems.length;
          page++;
          console.log(`Fetched page ${page - 1}: ${items.length} items (total so far: ${allItems.length})`);
        }

   
        if (batchFilter) {
          const before = allItems.length;
          allItems = filterRecordsByBatch(allItems, batchFilter.field, batchFilter.value);
          resolvedFilteringMethod = 'client';
          console.log(`✓ Client-side filter applied: ${before} → ${allItems.length} items`);
        }
      }

      console.log('Final fetch count:', allItems.length);
      return { items: allItems, filteringMethod: resolvedFilteringMethod };

    } catch (err) {
      console.error('fetchLiferayObjectData error:', err);
      throw new Error(`Error fetching Liferay data: ${err.message}`);
    }
  };


  const compareValues = (sourceValue, targetValue) => {
    if (sourceValue == null && targetValue == null) return true;
    if (sourceValue == null || targetValue == null) return false;

    const src = String(sourceValue).trim();
    const tgt = String(targetValue).trim();

    const srcNum = Number(src);
    const tgtNum = Number(tgt);
    if (!isNaN(srcNum) && !isNaN(tgtNum)) return srcNum === tgtNum;

    return src === tgt;
  };


  const findMatchingRecord = (sourceRecord, targetData, keyField) =>
    targetData.find(t => compareValues(sourceRecord[keyField], t[keyField]));

  
  const performReconciliation = (
    sourceData,
    targetData,
    headers,
    batchFilterInfo,
    resolvedFilteringMethod
  ) => {
    
    let filteredSource = sourceData;
    if (batchFilterInfo?.enabled) {
      filteredSource = filterRecordsByBatch(
        sourceData,
        batchFilterInfo.field,
        batchFilterInfo.value
      );
      console.log(
        `Source batch filter: ${sourceData.length} → ${filteredSource.length} records`
      );
    }

    const keyField = headers[0];

    const result = {
      sourceCount: filteredSource.length,
      targetCount: targetData.length,
      totalSourceCount: sourceData.length,
      totalTargetCount: targetData.length,
      countMatch: filteredSource.length === targetData.length,
      batchFilterApplied: batchFilterInfo?.enabled || false,
      batchFilterField: batchFilterInfo?.field || null,
      batchFilterValue: batchFilterInfo?.value || null,
      filteringMethod: resolvedFilteringMethod,
      recordComparisons: [],
      summary: {
        totalRecords: filteredSource.length,
        matchedRecords: 0,
        unmatchedRecords: 0,
        missingInTarget: 0,
        fieldMismatches: 0,
      },
    };

    for (const sourceRecord of filteredSource) {
      const comparison = {
        keyValue: sourceRecord[keyField],
        status: 'unmatched',
        fieldComparisons: [],
        missingInTarget: false,
      };

      const targetRecord = findMatchingRecord(sourceRecord, targetData, keyField);

      if (!targetRecord) {
        comparison.status = 'missing';
        comparison.missingInTarget = true;
        result.summary.missingInTarget++;
      } else {
        let allMatch = true;

        for (const field of headers) {
          const srcVal = sourceRecord[field];
          const tgtVal = targetRecord[field];
          const matches = compareValues(srcVal, tgtVal);

          comparison.fieldComparisons.push({ field, sourceValue: srcVal, targetValue: tgtVal, matches });

          if (!matches) {
            allMatch = false;
            result.summary.fieldMismatches++;
          }
        }

        comparison.status = allMatch ? 'matched' : 'mismatch';
        allMatch ? result.summary.matchedRecords++ : result.summary.unmatchedRecords++;
      }

      result.recordComparisons.push(comparison);
    }

    return result;
  };

 
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'text/csv') {
      setSourceFile(file);
      setFileName(file.name);
      setError(null);

      const reader = new FileReader();
      reader.onload = (e) => {
        const { headers } = parseCSV(e.target.result);
        setAvailableFields(headers);
        if (headers.length > 0) setBatchField(headers[0]);
      };
      reader.readAsText(file);
    } else {
      setError('Please upload a valid CSV file');
    }
  };


  const executeReconciliation = async () => {
    if (!sourceFile || !objectDefinition) {
      setError('Please provide both a source CSV file and an object definition name');
      return;
    }
    if (showBatchSection && batchMode === 'batch') {
      if (!batchField) { setError('Please select a batch field'); return; }
      if (!batchValue.trim()) { setError('Please enter a batch value'); return; }
    }

    setLoading(true);
    setError(null);
    setFilteringMethod(null);
    setReconciliationResult(null);

    try {
      const fileText = await sourceFile.text();
      const { headers, records: sourceData } = parseCSV(fileText);

      const isActiveBatch = showBatchSection && batchMode === 'batch';
      const batchFilter = isActiveBatch
        ? { field: batchField, value: batchValue.trim() }
        : null;
      const batchFilterInfo = isActiveBatch
        ? { enabled: true, field: batchField, value: batchValue.trim() }
        : null;

      const { items: targetData, filteringMethod: resolvedFilteringMethod } =
        await fetchLiferayObjectData(objectDefinition, batchFilter);

      if (isActiveBatch) {
        setFilteringMethod(resolvedFilteringMethod);
      } else {
        setFilteringMethod(null);
      }

      const result = performReconciliation(
        sourceData,
        targetData,
        headers,
        batchFilterInfo,
        resolvedFilteringMethod
      );

      setReconciliationResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };


  const downloadReport = () => {
    if (!reconciliationResult) return;

    let txt = 'OBJECT RECONCILIATION REPORT\n';
    txt += '='.repeat(80) + '\n\n';
    txt += `Generated:         ${new Date().toLocaleString()}\n`;
    txt += `Object Definition: ${objectDefinition}\n`;

    if (reconciliationResult.batchFilterApplied) {
      txt += `\nBATCH FILTER:\n`;
      txt += `  Field:  ${reconciliationResult.batchFilterField}\n`;
      txt += `  Value:  ${reconciliationResult.batchFilterValue}\n`;
      if (reconciliationResult.filteringMethod) {
        txt += `  Method: ${reconciliationResult.filteringMethod}\n`;
      }
    }

    txt += `\nSUMMARY\n${'-'.repeat(80)}\n`;
    txt += `Source Count:       ${reconciliationResult.sourceCount}\n`;
    txt += `Target Count:       ${reconciliationResult.targetCount}\n`;
    txt += `Count Match:        ${reconciliationResult.countMatch ? 'YES' : 'NO'}\n`;
    txt += `Matched Records:    ${reconciliationResult.summary.matchedRecords}\n`;
    txt += `Unmatched Records:  ${reconciliationResult.summary.unmatchedRecords}\n`;
    txt += `Missing in Target:  ${reconciliationResult.summary.missingInTarget}\n`;
    txt += `Field Mismatches:   ${reconciliationResult.summary.fieldMismatches}\n`;

    txt += `\nDETAILED COMPARISON\n${'-'.repeat(80)}\n\n`;

    reconciliationResult.recordComparisons.forEach((c, i) => {
      txt += `Record ${i + 1} — Key: ${c.keyValue}  [${c.status.toUpperCase()}]\n`;
      if (c.missingInTarget) {
        txt += `  ERROR: Record not found in target\n`;
      } else {
        c.fieldComparisons.forEach(f => {
          txt += `  ${f.matches ? '✓' : '✗'} ${f.field}: "${f.sourceValue}" vs "${f.targetValue}"\n`;
        });
      }
      txt += '\n';
    });

    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation_${objectDefinition}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

 
  const getStatusColor = (status) => {
    switch (status) {
      case 'matched': return 'var(--ort-success)';
      case 'mismatch': return 'var(--ort-warning)';
      case 'missing':  return 'var(--ort-error)';
      default:         return 'var(--ort-default)';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'matched': return '✓';
      case 'mismatch': return '⚠';
      case 'missing':  return '✗';
      default:         return '○';
    }
  };

  /
  return (
    <div className="ort-container">

     
      <div className="ort-header">
        <h1>Object Reconciliation Tool</h1>
        <p>Validate CSV imports against Liferay Object data</p>
      </div>

    
      <div className="ort-input-section">

        
        <div className="ort-input-grid">
          <div className="ort-input-group">
            <label className="ort-label">Source CSV File</label>
            <label className="ort-upload-box">
              <div className="ort-upload-content">
                <svg className="ort-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p>{fileName || 'Click to upload CSV'}</p>
              </div>
              <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
          </div>

          <div className="ort-input-group">
            <label className="ort-label">Liferay Object Definition Name</label>
            <input
              type="text"
              value={objectDefinition}
              onChange={(e) => setObjectDefinition(e.target.value)}
              placeholder="e.g., myobject"
              className="ort-input"
            />
            <p className="ort-hint">API name used in /o/c/{objectDefinition || 'objectname'}</p>
          </div>
        </div>

        
        <div className="ort-toggle-section">
          <button
            type="button"
            onClick={() => setShowBatchSection(!showBatchSection)}
            className="ort-toggle-button"
          >
            <div className="ort-toggle-header">
              <div className="ort-toggle-title">
                <svg className="ort-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span>Batch Filtering</span>
                {showBatchSection && batchMode === 'batch' && batchValue && (
                  <span className="ort-toggle-active-badge">
                    {batchField} = {batchValue}
                  </span>
                )}
              </div>
              <svg
                className={`ort-toggle-chevron ${showBatchSection ? 'ort-toggle-chevron-open' : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <p className="ort-toggle-description">
              Filter validation to a specific batch or validate all records
            </p>
          </button>

          {showBatchSection && (
            <div className="ort-toggle-content">


              <div className="ort-radio-group">
                <label className="ort-radio-label">
                  <input
                    type="radio"
                    name="batchMode"
                    value="all"
                    checked={batchMode === 'all'}
                    onChange={(e) => setBatchMode(e.target.value)}
                    className="ort-radio"
                  />
                  <div className="ort-radio-content">
                    <span className="ort-radio-title">All Records</span>
                    <span className="ort-radio-description">Validate every record in the dataset</span>
                  </div>
                </label>

                <label className="ort-radio-label">
                  <input
                    type="radio"
                    name="batchMode"
                    value="batch"
                    checked={batchMode === 'batch'}
                    onChange={(e) => setBatchMode(e.target.value)}
                    className="ort-radio"
                  />
                  <div className="ort-radio-content">
                    <span className="ort-radio-title">Specific Batch</span>
                    <span className="ort-radio-description">Validate records from one batch only</span>
                  </div>
                </label>
              </div>

              
              {batchMode === 'batch' && (
                <div className="ort-batch-inputs">
                  <div className="ort-input-group">
                    <label className="ort-label">Batch Field</label>
                    <select
                      value={batchField}
                      onChange={(e) => setBatchField(e.target.value)}
                      className="ort-select"
                      disabled={availableFields.length === 0}
                    >
                      {availableFields.length === 0
                        ? <option value="">Upload CSV first</option>
                        : availableFields.map(f => <option key={f} value={f}>{f}</option>)
                      }
                    </select>
                    <p className="ort-hint">Field containing the batch identifier</p>
                  </div>

                  <div className="ort-input-group">
                    <label className="ort-label">Batch Value</label>
                    <input
                      type="text"
                      value={batchValue}
                      onChange={(e) => setBatchValue(e.target.value)}
                      placeholder="e.g., 2 or BATCH-2024-01"
                      className="ort-input"
                    />
                    <p className="ort-hint">
                      {batchValue
                        ? isNumericValue(batchValue)
                          ? `Detected as numeric — filter: ${batchField} eq ${batchValue}`
                          : `Detected as text — filter: ${batchField} eq '${batchValue}'`
                        : 'Enter the batch number or identifier'
                      }
                    </p>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

        
        <button
          onClick={executeReconciliation}
          disabled={loading || !fileName || !objectDefinition}
          className="ort-button ort-button-primary"
        >
          {loading
            ? <><span className="ort-spinner" />Processing...</>
            : 'Generate Reconciliation Report'
          }
        </button>
      </div>

     
      {error && (
        <div className="ort-error">
          <strong>Error</strong>
          <p>{error}</p>
        </div>
      )}

     
      {reconciliationResult && (
        <div className="ort-results">

          
          {reconciliationResult.batchFilterApplied && (
            <div className="ort-batch-banner">
              <div className="ort-banner-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="ort-banner-content">
                <strong>Batch Filtering Active</strong>
                <p>
                  Field <strong>{reconciliationResult.batchFilterField}</strong> = <strong>{reconciliationResult.batchFilterValue}</strong>
                </p>
                {reconciliationResult.filteringMethod && (
                  <p className="ort-banner-meta">
                    Filtering Method:&nbsp;
                    <span className={`ort-method-badge ort-method-${reconciliationResult.filteringMethod}`}>
                      {reconciliationResult.filteringMethod}
                    </span>
                    {reconciliationResult.filteringMethod === 'client' &&
                      ' — server-side filter unavailable, used client-side fallback'}
                  </p>
                )}
                <p className="ort-banner-meta">
                  Source: {reconciliationResult.totalSourceCount} → {reconciliationResult.sourceCount} records
                  &nbsp;|&nbsp;
                  Target: {reconciliationResult.totalTargetCount} → {reconciliationResult.targetCount} records
                </p>
              </div>
            </div>
          )}

          
          <div className="ort-summary-grid">
            <div className="ort-card ort-card-blue">
              <p className="ort-card-label">Source Count</p>
              <p className="ort-card-value">{reconciliationResult.sourceCount}</p>
            </div>
            <div className="ort-card ort-card-purple">
              <p className="ort-card-label">Target Count</p>
              <p className="ort-card-value">{reconciliationResult.targetCount}</p>
            </div>
            <div className={`ort-card ${reconciliationResult.countMatch ? 'ort-card-green' : 'ort-card-red'}`}>
              <p className="ort-card-label">Count Match</p>
              <p className="ort-card-value">{reconciliationResult.countMatch ? 'YES' : 'NO'}</p>
            </div>
            <div className="ort-card ort-card-green">
              <p className="ort-card-label">Matched</p>
              <p className="ort-card-value">{reconciliationResult.summary.matchedRecords}</p>
            </div>
          </div>

          
          <div className="ort-summary-detail">
            <h3>Summary</h3>
            <div className="ort-summary-stats">
              <div>
                <span className="ort-stat-label">Unmatched Records:</span>
                <span className="ort-stat-value ort-stat-warning">
                  {reconciliationResult.summary.unmatchedRecords}
                </span>
              </div>
              <div>
                <span className="ort-stat-label">Missing in Target:</span>
                <span className="ort-stat-value ort-stat-error">
                  {reconciliationResult.summary.missingInTarget}
                </span>
              </div>
              <div>
                <span className="ort-stat-label">Field Mismatches:</span>
                <span className="ort-stat-value ort-stat-warning">
                  {reconciliationResult.summary.fieldMismatches}
                </span>
              </div>
            </div>
          </div>

       
          <button onClick={downloadReport} className="ort-button ort-button-success">
            <svg className="ort-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Full Report
          </button>

         
          <div className="ort-comparison">
            <div className="ort-comparison-header">
              <h3>Detailed Record Comparison</h3>
            </div>
            <div className="ort-comparison-list">
              {reconciliationResult.recordComparisons.map((c, i) => (
                <div key={i} className="ort-comparison-item">
                  <div className="ort-comparison-item-header">
                    <div className="ort-comparison-item-title">
                      <span className="ort-status-icon" style={{ color: getStatusColor(c.status) }}>
                        {getStatusIcon(c.status)}
                      </span>
                      <span className="ort-record-label">Record {i + 1}</span>
                      <span className="ort-record-key">(Key: {c.keyValue})</span>
                    </div>
                    <span className="ort-status-badge" style={{ color: getStatusColor(c.status) }}>
                      {c.status.toUpperCase()}
                    </span>
                  </div>

                  {c.missingInTarget ? (
                    <div className="ort-missing-msg">
                      Record not found in target Liferay Object
                    </div>
                  ) : (
                    <div className="ort-field-list">
                      {c.fieldComparisons.map((f, fi) => (
                        <div
                          key={fi}
                          className={`ort-field-row ${f.matches ? 'ort-field-match' : 'ort-field-mismatch'}`}
                        >
                          <span className={f.matches ? 'ort-icon-success' : 'ort-icon-error'}>
                            {f.matches ? '✓' : '✗'}
                          </span>
                          <span className="ort-field-name">{f.field}:</span>
                          <span className="ort-field-value">"{f.sourceValue}"</span>
                          {!f.matches && (
                            <>
                              <span className="ort-field-arrow">→</span>
                              <span className="ort-field-value">"{f.targetValue}"</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

export default ObjectReconciliationTool;
