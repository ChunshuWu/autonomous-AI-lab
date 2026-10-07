"""Export only source selected for Git; never copy local research."""
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def source_files(root=ROOT):
    git=subprocess.run(['git','-C',str(root),'rev-parse','--show-toplevel'],capture_output=True,text=True)
    if git.returncode==0 and Path(git.stdout.strip()).resolve()==root.resolve():
        names=subprocess.check_output(['git','-C',str(root),'ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
    else:
        # Apply .gitignore to a source archive without creating .git inside it.
        with tempfile.TemporaryDirectory(prefix='lab-source-index-') as d:
            subprocess.run(['git','init','--quiet','--bare',d],check=True)
            names=subprocess.check_output(['git','--git-dir='+d,'--work-tree='+str(root),'ls-files','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
    return sorted({root/n for n in names if n and (root/n).is_file()})

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('destination',type=Path);a=p.parse_args()
    dest=a.destination.resolve()
    if dest==ROOT or dest.is_relative_to(ROOT):p.error('Use a destination outside the lab.')
    dest.mkdir(parents=True,exist_ok=False)
    for src in source_files():
        if src.is_symlink():raise ValueError('Source symlink: '+str(src.relative_to(ROOT)))
        target=dest/src.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,target)
    print('Exported source only to',dest)

if __name__=='__main__':main()
