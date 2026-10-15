import openpyxl
import json
import os
import re

EXCEL_FILE = os.path.join(os.path.dirname(__file__), '..', 'BAUCHI - Copy.xlsx')
OUTPUT_JSON = os.path.join(os.path.dirname(__file__), 'db', 'bauchi_seed_data.json')

LGA_MAPPING = {
    'ALKALERI': 1,
    'BAUCHI': 2,
    'BOGORO': 3,
    'DAMBAM': 4,
    'DAMBAN': 4,
    'DARAZO': 5,
    'DASS': 6,
    'GAMAWA': 7,
    'GANJUWA': 8,
    'GIADE': 9,
    'ITAS/GADAU': 10,
    'ITAS / GADAU': 10,
    "JAMA'ARE": 11,
    'JAMA ARE': 11,
    'KATAGUM': 12,
    'KIRFI': 13,
    'MISAU': 14,
    'NINGI': 15,
    'SHIRA': 16,
    'TAFAWA BALEWA': 17,
    'TORO': 18,
    'WARJI': 19,
    'ZAKI': 20
}

def clean_str(val):
    if val is None:
        return ''
    s = str(val).strip()
    # Normalize multiple spaces
    s = re.sub(r'\s+', ' ', s)
    return s

def parse_excel():
    print(f"Loading workbook: {EXCEL_FILE} ...")
    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    sheet = wb.active

    # Data structures
    # Ward unique key: (lga_id, ward_name)
    ward_id_map = {}
    wards_list = []
    polling_units_list = []
    
    ward_counter = 1
    pu_counter = 1
    total_registered_voters = 0

    for i, row in enumerate(sheet.iter_rows(values_only=True)):
        if i < 4 or not any(row):
            continue
        
        # Row format: S/N, STATE, LGA, REGISTRATION AREA, POLLING UNIT, DELIMITATION, REG VOTER
        row_cells = [clean_str(c) for c in row[:7]]
        if len(row_cells) < 6:
            continue
            
        sn, state, lga_raw, ward_raw, pu_name, delim = row_cells[:6]
        reg_voters_raw = row_cells[6] if len(row_cells) > 6 else '0'

        if not pu_name or not delim or not lga_raw:
            continue

        lga_key = lga_raw.upper()
        lga_id = LGA_MAPPING.get(lga_key)
        if not lga_id:
            raise ValueError(f"Unknown LGA '{lga_raw}' at row {i+1}")

        ward_name = ward_raw.upper()
        ward_tuple = (lga_id, ward_name)

        if ward_tuple not in ward_id_map:
            ward_id = ward_counter
            ward_id_map[ward_tuple] = ward_id
            wards_list.append({
                'id': ward_id,
                'lga_id': lga_id,
                'name': ward_name
            })
            ward_counter += 1
        else:
            ward_id = ward_id_map[ward_tuple]

        # Parse voters count
        try:
            voters = int(float(reg_voters_raw)) if reg_voters_raw else 0
        except ValueError:
            voters = 0
            
        total_registered_voters += voters

        pu_id = pu_counter
        polling_units_list.append({
            'id': pu_id,
            'ward_id': ward_id,
            'name': pu_name,
            'code': delim,
            'total_voters': voters
        })
        pu_counter += 1

    print(f"\nParsing Summary:")
    print(f"  Total Wards: {len(wards_list)}")
    print(f"  Total Polling Units: {len(polling_units_list)}")
    print(f"  Total Registered Voters: {total_registered_voters:,}")

    # Write output JSON
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump({
            'wards': wards_list,
            'pollingUnits': polling_units_list
        }, f, indent=2)

    print(f"Saved seed JSON to {OUTPUT_JSON}")

if __name__ == '__main__':
    parse_excel()
