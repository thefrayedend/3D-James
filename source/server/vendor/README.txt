Libraries the 3DJames box server carries with it (pure Python, no install needed):
  smb, nmb   pysmb 1.2.15 (https://github.com/miketeo/pysmb), zlib/libpng license: LICENSE-pysmb.txt
  pyasn1     pyasn1 0.6.4 (https://github.com/pyasn1/pyasn1), BSD 2-clause license: LICENSE-pyasn1.txt
  tqdm.py    a do-nothing stand-in (pysmb imports tqdm for progress bars, which the box never shows)
They let the box talk to a NAS (SMB / Windows file sharing) itself, without the Linux kernel's CIFS driver.
